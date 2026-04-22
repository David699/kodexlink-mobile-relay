import type { Logger } from "@kodexlink/shared";

import { ProductServiceStateStore } from "../product/service-state-store.js";
import type { RelayConnectionStateSnapshot } from "../relay/relay-connection-state.js";
import { ServiceStateNotifier } from "./service-state-notifier.js";

interface RelayConnectionMonitorOptions {
  logger: Logger;
  stateStore: ProductServiceStateStore;
  notifier: ServiceStateNotifier;
  offlineNotifyDelayMs?: number;
}

export class RelayConnectionMonitor {
  private readonly offlineNotifyDelayMs: number;
  private offlineTimer: NodeJS.Timeout | null = null;
  private offlineNotified = false;
  private lastSnapshot: RelayConnectionStateSnapshot | null = null;

  public constructor(private readonly options: RelayConnectionMonitorOptions) {
    this.offlineNotifyDelayMs = options.offlineNotifyDelayMs ?? 60_000;
  }

  public onStateChanged(snapshot: RelayConnectionStateSnapshot): void {
    this.lastSnapshot = snapshot;

    void this.options.stateStore
      .write({
        relayUrl: snapshot.relayUrl,
        status: snapshot.status,
        lastConnectedAt: snapshot.lastConnectedAt,
        lastError: snapshot.lastError,
        nextRetryAt: snapshot.nextRetryAt,
        reconnectAttempt: snapshot.reconnectAttempt
      })
      .catch((error) => {
        this.options.logger.warn("failed to persist desktop-agent service state", {
          message: error instanceof Error ? error.message : String(error)
        });
      });

    if (snapshot.status === "online") {
      const shouldNotifyRecovered = this.offlineNotified;
      this.clearOfflineTimer();
      this.offlineNotified = false;
      if (shouldNotifyRecovered) {
        void this.options.notifier.notifyRecovered(
          `已重新连接到 ${snapshot.relayUrl}`
        );
      }
      return;
    }

    if (snapshot.status === "reconnecting") {
      this.scheduleOfflineNotification(snapshot);
      return;
    }

    if (snapshot.status === "offline") {
      this.scheduleOfflineNotification(snapshot);
      return;
    }

    this.clearOfflineTimer();
  }

  private scheduleOfflineNotification(snapshot: RelayConnectionStateSnapshot): void {
    if (this.offlineNotified || this.offlineTimer) {
      return;
    }

    this.offlineTimer = setTimeout(() => {
      this.offlineTimer = null;

      const current = this.lastSnapshot;
      if (!current || (current.status !== "reconnecting" && current.status !== "offline")) {
        return;
      }

      this.offlineNotified = true;
      const retryHint = current.nextRetryAt ? `下次重试：${current.nextRetryAt}` : "正在自动重试";
      const detail = current.lastError
        ? `${current.lastError}。${retryHint}`
        : retryHint;

      this.options.logger.warn("desktop-agent relay remains offline", {
        relayUrl: current.relayUrl,
        lastError: current.lastError,
        nextRetryAt: current.nextRetryAt,
        reconnectAttempt: current.reconnectAttempt
      });
      void this.options.notifier.notifyOffline(detail);
    }, this.offlineNotifyDelayMs);
  }

  private clearOfflineTimer(): void {
    if (!this.offlineTimer) {
      return;
    }

    clearTimeout(this.offlineTimer);
    this.offlineTimer = null;
  }
}
