import type { AgentHealthReportPayload } from "@kodexlink/protocol";
import type { Logger } from "@kodexlink/shared";

interface AgentHealthControllerOptions {
  requestFailureThreshold?: number;
}

type HealthReporter = (payload: AgentHealthReportPayload) => void;

export class AgentHealthController {
  private readonly requestFailureThreshold: number;
  private runtimeAvailable = false;
  private consecutiveRequestFailures = 0;
  private hasRuntimeObservation = false;
  private reporter: HealthReporter | null = null;
  private currentPayload: AgentHealthReportPayload = {
    status: "online"
  };
  private lastPublishedSignature: string | null = null;

  public constructor(
    private readonly logger: Logger,
    options: AgentHealthControllerOptions = {}
  ) {
    this.requestFailureThreshold = options.requestFailureThreshold ?? 3;
  }

  public bindReporter(reporter: HealthReporter): void {
    this.reporter = reporter;
    this.publishIfNeeded();
  }

  public markRuntimeAvailable(detail = "codex app-server 已就绪"): void {
    this.runtimeAvailable = true;
    this.hasRuntimeObservation = true;
    this.logger.info("agent runtime available", { detail });
    this.recompute(detail);
  }

  public markRuntimeUnavailable(detail: string): void {
    this.runtimeAvailable = false;
    this.hasRuntimeObservation = true;
    this.logger.warn("agent runtime unavailable", { detail });
    this.recompute(detail);
  }

  public recordCoreRequestSuccess(operation: string): void {
    if (this.consecutiveRequestFailures > 0) {
      this.logger.info("agent core request recovered", {
        operation,
        consecutiveFailures: this.consecutiveRequestFailures
      });
    }

    this.consecutiveRequestFailures = 0;
    this.recompute(`${operation} 已恢复正常`);
  }

  public recordCoreRequestFailure(operation: string, error: unknown): void {
    this.consecutiveRequestFailures += 1;
    const detail = error instanceof Error ? error.message : String(error);

    this.logger.warn("agent core request failed", {
      operation,
      consecutiveFailures: this.consecutiveRequestFailures,
      detail
    });

    this.recompute(`${operation} 失败：${detail}`);
  }

  private recompute(detail: string): void {
    if (!this.hasRuntimeObservation) {
      return;
    }

    if (!this.runtimeAvailable) {
      this.currentPayload = {
        status: "degraded",
        reason: "runtime_unavailable",
        detail
      };
      this.publishIfNeeded();
      return;
    }

    if (this.consecutiveRequestFailures >= this.requestFailureThreshold) {
      this.currentPayload = {
        status: "degraded",
        reason: "request_failures",
        detail,
        consecutiveFailures: this.consecutiveRequestFailures
      };
      this.publishIfNeeded();
      return;
    }

    this.currentPayload = {
      status: "online"
    };
    this.publishIfNeeded();
  }

  private publishIfNeeded(): void {
    if (!this.reporter || !this.hasRuntimeObservation) {
      return;
    }

    const signature = JSON.stringify(this.currentPayload);
    if (signature === this.lastPublishedSignature) {
      return;
    }

    this.lastPublishedSignature = signature;
    this.reporter(this.currentPayload);
  }
}
