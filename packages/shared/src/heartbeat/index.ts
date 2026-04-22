import type { Logger } from "../logger/index.js";

export const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;
export const DEFAULT_HEARTBEAT_MAX_MISSES = 3;

export interface NodeHeartbeatTimeoutContext {
  missedHeartbeats: number;
  silentMs: number;
}

interface NodeHeartbeatOptions {
  label: string;
  logger?: Logger;
  intervalMs?: number;
  maxMisses?: number;
  onTick: () => void;
  onTimeout: (context: NodeHeartbeatTimeoutContext) => void;
}

export class NodeHeartbeat {
  private readonly intervalMs: number;
  private readonly maxMisses: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private missedHeartbeats = 0;

  public constructor(private readonly options: NodeHeartbeatOptions) {
    this.intervalMs = options.intervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    this.maxMisses = options.maxMisses ?? DEFAULT_HEARTBEAT_MAX_MISSES;
  }

  public start(): void {
    this.stop();
    this.timer = setInterval(() => {
      this.missedHeartbeats += 1;
      if (this.missedHeartbeats >= this.maxMisses) {
        const context: NodeHeartbeatTimeoutContext = {
          missedHeartbeats: this.missedHeartbeats,
          silentMs: this.missedHeartbeats * this.intervalMs
        };
        this.options.logger?.warn("heartbeat timeout", {
          scope: this.options.label,
          ...context
        });
        this.stop();
        this.options.onTimeout(context);
        return;
      }

      this.options.onTick();
    }, this.intervalMs);
  }

  public acknowledge(): void {
    this.missedHeartbeats = 0;
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.missedHeartbeats = 0;
  }
}
