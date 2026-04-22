import { randomUUID } from "node:crypto";

import type { DeviceType } from "@kodexlink/protocol";

import {
  DeviceAlreadyInitializedError,
  PostgresStore,
  type BindingRecord,
  type DeviceAuthResult,
  type DeviceBootstrapResult,
  type DeviceRecord
} from "./postgres.js";
import { RedisStore, type PairingSessionRecord } from "./redis-store.js";

export type {
  BindingRecord,
  DeviceAuthResult,
  DeviceBootstrapResult,
  DeviceRecord,
  PairingSessionRecord
};
export { DeviceAlreadyInitializedError };

/**
 * 统一存储层：组合 PostgreSQL（持久身份/绑定）+ Redis（临时态/幂等）。
 * 对外暴露与旧 RelayStateStore 一致的语义接口，内部按数据特性分发到不同后端。
 */
export class RelayStore {
  public readonly pg: PostgresStore;
  public readonly redis: RedisStore;

  public constructor(databaseUrl: string, redisUrl: string) {
    this.pg = new PostgresStore(databaseUrl);
    this.redis = new RedisStore(redisUrl);
  }

  async initialize(): Promise<void> {
    await this.pg.initialize();
  }

  async migrate(): Promise<Awaited<ReturnType<PostgresStore["migrate"]>>> {
    return this.pg.migrate();
  }

  async close(): Promise<void> {
    await this.pg.close();
    await this.redis.close();
  }

  // ── Device（PG）──────────────────────────────────────────────────

  async getDevice(deviceId: string): Promise<DeviceRecord | undefined> {
    return this.pg.getDevice(deviceId);
  }

  async bootstrapDevice(input: {
    deviceType: DeviceType;
    deviceId?: string;
    deviceName: string;
    runtimeType?: string;
    nowSeconds: number;
  }): Promise<DeviceBootstrapResult> {
    return this.pg.bootstrapDevice(input);
  }

  async validateDevice(
    deviceType: DeviceType,
    deviceId: string,
    deviceToken: string
  ): Promise<DeviceAuthResult> {
    return this.pg.validateDevice(deviceType, deviceId, deviceToken);
  }

  async refreshDeviceTokens(input: {
    deviceId: string;
    refreshToken: string;
    nowSeconds: number;
  }): Promise<
    | { ok: true; device: DeviceRecord; tokens: DeviceBootstrapResult["tokens"] }
    | { ok: false; code: string; message: string }
  > {
    return this.pg.refreshDeviceTokens(input);
  }

  async revokeActiveTokensForDevice(input: {
    deviceId: string;
    revokeReason: string;
    nowSeconds: number;
  }): Promise<number> {
    return this.pg.revokeActiveTokensForDevice(input);
  }

  // ── Binding（PG）─────────────────────────────────────────────────

  async getBinding(bindingId: string): Promise<BindingRecord | undefined> {
    return this.pg.getBinding(bindingId);
  }

  async getBindingsForMobileDevice(mobileDeviceId: string): Promise<BindingRecord[]> {
    return this.pg.getBindingsForMobileDevice(mobileDeviceId);
  }

  async getBindingsForAgent(agentId: string): Promise<BindingRecord[]> {
    return this.pg.getBindingsForAgent(agentId);
  }

  async touchBinding(bindingId: string, nowSeconds: number): Promise<void> {
    await this.pg.touchBinding(bindingId, nowSeconds);
  }

  // ── Pairing（Redis）──────────────────────────────────────────────

  async createPairing(input: {
    agentId: string;
    agentLabel: string;
    relayBaseUrl: string;
    nowSeconds: number;
  }): Promise<PairingSessionRecord> {
    return this.redis.createPairing({
      pairingId: `pair_${randomUUID()}`,
      pairingSecret: `secret_${randomUUID()}`,
      ...input
    });
  }

  async claimPairing(input: {
    pairingId: string;
    pairingSecret: string;
    mobileDeviceId: string;
    displayName: string;
    nowSeconds: number;
  }): Promise<{ pairing: PairingSessionRecord; binding: BindingRecord } | null> {
    // 1. 原子锁定 pairing（pending → claiming），并发下只有一个调用者能成功
    const pairing = await this.redis.lockPairing(input.pairingId);
    if (!pairing) {
      return null;
    }

    // 2. 校验 secret 和有效期
    if (pairing.pairingSecret !== input.pairingSecret || pairing.expiresAt < input.nowSeconds) {
      await this.redis.releasePairing(input.pairingId);
      return null;
    }

    // 3. 写 PG（如果失败则回滚 Redis，让用户可以重试）
    try {
      // 检查是否已有同一 agent ↔ mobile 的 binding
      const existing = await this.pg.findExistingBinding(pairing.agentId, input.mobileDeviceId);
      if (existing) {
        await this.pg.touchBinding(existing.bindingId, input.nowSeconds);
        await this.redis.consumePairing(input.pairingId);
        return {
          pairing: { ...pairing, status: "claimed", claimedByMobileDeviceId: input.mobileDeviceId },
          binding: existing
        };
      }

      // 创建新 binding（is_default 由 PG 原子判定，见 createBinding）
      const binding = await this.pg.createBinding({
        bindingId: `bind_${randomUUID()}`,
        agentId: pairing.agentId,
        mobileDeviceId: input.mobileDeviceId,
        displayName: input.displayName,
        nowSeconds: input.nowSeconds
      });

      // 4. PG 成功，消费 pairing
      await this.redis.consumePairing(input.pairingId);
      return {
        pairing: { ...pairing, status: "claimed", claimedByMobileDeviceId: input.mobileDeviceId },
        binding
      };
    } catch (error) {
      // PG 失败：回滚 Redis，让配对码可重试
      await this.redis.releasePairing(input.pairingId);
      throw error;
    }
  }

  // ── 幂等（Redis）─────────────────────────────────────────────────

  async acquireIdempotency(bindingId: string, operation: string, key: string): Promise<boolean> {
    return this.redis.acquireIdempotency(bindingId, operation, key);
  }
}
