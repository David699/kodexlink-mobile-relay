import { Redis as IORedis } from "ioredis";

export interface PairingSessionRecord {
  pairingId: string;
  pairingSecret: string;
  agentId: string;
  agentLabel: string;
  relayBaseUrl: string;
  expiresAt: number;
  claimedByMobileDeviceId?: string;
  status: "pending" | "claiming" | "claimed" | "expired";
  createdAt: number;
}

const PAIRING_TTL = 300; // 5 分钟
const PAIRING_PREFIX = "pairing:";
const IDEM_PREFIX = "idem:";
const IDEM_TTL = 600; // 10 分钟

/**
 * Lua 脚本：原子地将 pairing 从 "pending" 锁定为 "claiming"。
 * 并发下只有一个调用者能成功，返回原始 JSON（status 仍为 pending）。
 * 失败返回 nil。
 */
const LOCK_PAIRING_LUA = `
local key = KEYS[1]
local val = redis.call('GET', key)
if not val then return nil end
local pairing = cjson.decode(val)
if pairing.status ~= 'pending' then return nil end
pairing.status = 'claiming'
local ttl = redis.call('TTL', key)
if ttl <= 0 then
  redis.call('DEL', key)
  return nil
end
redis.call('SET', key, cjson.encode(pairing), 'EX', ttl)
return val
`;

export class RedisStore {
  private client: IORedis;

  public constructor(redisUrl: string) {
    this.client = new IORedis(redisUrl);
  }

  async close(): Promise<void> {
    await this.client.quit();
  }

  // ── Pairing（临时态，TTL 自动过期）──────────────────────────────

  async createPairing(input: {
    pairingId: string;
    pairingSecret: string;
    agentId: string;
    agentLabel: string;
    relayBaseUrl: string;
    nowSeconds: number;
  }): Promise<PairingSessionRecord> {
    const record: PairingSessionRecord = {
      pairingId: input.pairingId,
      pairingSecret: input.pairingSecret,
      agentId: input.agentId,
      agentLabel: input.agentLabel,
      relayBaseUrl: input.relayBaseUrl,
      expiresAt: input.nowSeconds + PAIRING_TTL,
      status: "pending",
      createdAt: input.nowSeconds
    };

    await this.client.set(
      `${PAIRING_PREFIX}${input.pairingId}`,
      JSON.stringify(record),
      "EX",
      PAIRING_TTL
    );

    return record;
  }

  async getPairing(pairingId: string): Promise<PairingSessionRecord | null> {
    const raw = await this.client.get(`${PAIRING_PREFIX}${pairingId}`);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as PairingSessionRecord;
  }

  /**
   * 原子锁定 pairing：pending → claiming。
   * 并发下只有一个调用者能拿到非 null 结果。
   * 返回锁定前的原始记录（status = pending）。
   */
  async lockPairing(pairingId: string): Promise<PairingSessionRecord | null> {
    const raw = await this.client.eval(
      LOCK_PAIRING_LUA,
      1,
      `${PAIRING_PREFIX}${pairingId}`
    ) as string | null;

    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as PairingSessionRecord;
  }

  /**
   * PG 写入成功后调用：删除 pairing key，完成消费。
   */
  async consumePairing(pairingId: string): Promise<void> {
    await this.client.del(`${PAIRING_PREFIX}${pairingId}`);
  }

  /**
   * PG 写入失败时调用：将 pairing 从 "claiming" 回退到 "pending"，
   * 保留剩余 TTL，让用户可以重试。
   */
  async releasePairing(pairingId: string): Promise<void> {
    const key = `${PAIRING_PREFIX}${pairingId}`;
    const raw = await this.client.get(key);
    if (!raw) {
      return;
    }

    const pairing = JSON.parse(raw) as PairingSessionRecord;
    if (pairing.status !== "claiming") {
      return;
    }

    pairing.status = "pending";
    const ttl = await this.client.ttl(key);
    if (ttl > 0) {
      await this.client.set(key, JSON.stringify(pairing), "EX", ttl);
    }
  }

  // ── 幂等 TTL（SETNX + EXPIRE）──────────────────────────────────

  /**
   * 尝试设置幂等标记。
   * @returns true = 首次写入（可执行），false = 重复（应返回缓存结果）
   */
  async acquireIdempotency(bindingId: string, operation: string, key: string): Promise<boolean> {
    const idemKey = `${IDEM_PREFIX}${bindingId}:${operation}:${key}`;
    const result = await this.client.set(idemKey, "1", "EX", IDEM_TTL, "NX");
    return result === "OK";
  }
}
