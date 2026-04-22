import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import type { Logger } from "@kodexlink/shared";

import { PairingSnapshotController, type PairingSnapshot } from "../pairing/pairing-snapshot-controller.js";
import { openExternalUrl } from "../platform/open-external.js";
import { LocalPanelActions } from "./local-panel-actions.js";
import { getLocalPanelFavicon } from "./local-panel-favicon.js";
import { resolveLocalPanelLocale } from "./local-panel-i18n.js";
import { LocalPanelStateService } from "./local-panel-state-service.js";
import { renderLocalPanelHtml } from "./local-panel-template.js";

interface JsonObject {
  [key: string]: unknown;
}

const CLIENT_REQUEST_ERRORS = new Set([
  "resetIdentityConfirmationMismatchMessage",
  "resetIdentityUnavailableMessage"
]);

export class LocalPanelServer {
  private server = createServer((request, response) => {
    void this.handleRequest(request, response);
  });

  private port: number | null = null;
  private cleanupHandlersBound = false;
  private readonly handleSigint = () => {
    void this.shutdownForSignal(130);
  };
  private readonly handleSigterm = () => {
    void this.shutdownForSignal(0);
  };

  public constructor(
    private readonly stateService: LocalPanelStateService,
    private readonly actions: LocalPanelActions,
    private readonly pairingController: PairingSnapshotController,
    private readonly logger: Logger
  ) {}

  public async start(): Promise<{ url: string }> {
    if (this.port === null) {
      await new Promise<void>((resolve, reject) => {
        this.server.once("error", reject);
        this.server.listen(0, "127.0.0.1", () => {
          this.server.off("error", reject);
          resolve();
        });
      });

      const address = this.server.address();
      if (!address || typeof address === "string") {
        throw new Error("failed to resolve local panel address");
      }

      this.port = address.port;
      await this.stateService.recordLocalPanelStart(this.url);
      this.bindProcessCleanup();
    }

    return {
      url: this.url
    };
  }

  public async openInBrowser(): Promise<void> {
    await openExternalUrl(this.url);
  }

  public async getCurrentPairingSnapshot(): Promise<PairingSnapshot> {
    const { relayUrl } = this.stateService.getCurrentRelay();
    return this.pairingController.getCurrentSnapshot(relayUrl);
  }

  public async refreshPairingSnapshot(): Promise<PairingSnapshot> {
    const { relayUrl } = this.stateService.getCurrentRelay();
    return this.pairingController.refreshSnapshot(relayUrl);
  }

  public async stop(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        this.port = null;
        resolve();
      });
    });

    this.unbindProcessCleanup();
    await this.stateService.clearLocalPanelState();
  }

  private get url(): string {
    if (this.port === null) {
      throw new Error("local panel server is not running");
    }

    return `http://127.0.0.1:${this.port}`;
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");

      if (request.method === "GET" && url.pathname === "/") {
        const initialLocale = resolveLocalPanelLocale(request.headers["accept-language"]);
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(await renderLocalPanelHtml(initialLocale));
        return;
      }

      if (request.method === "GET" && url.pathname === "/healthz") {
        this.writeJson(response, 200, { ok: true });
        return;
      }

      if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/favicon.ico") {
        const favicon = getLocalPanelFavicon();
        response.writeHead(200, {
          "content-type": "image/x-icon",
          "content-length": favicon.length,
          "cache-control": "public, max-age=86400"
        });
        response.end(request.method === "HEAD" ? undefined : favicon);
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/status") {
        this.writeJson(response, 200, await this.stateService.loadStatus());
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/pairing/current") {
        this.writeJson(response, 200, await this.getCurrentPairingSnapshot());
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/pairing/refresh") {
        this.writeJson(response, 200, await this.refreshPairingSnapshot());
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/pairing/reset-identity") {
        const body = await this.readJsonBody(request);
        const confirmationText = typeof body.confirmationText === "string" ? body.confirmationText : "";
        try {
          const serviceStatus = await this.actions.resetIdentityAndRestart(confirmationText);
          this.writeJson(response, 200, {
            ok: true,
            service: serviceStatus,
            status: await this.stateService.loadStatus(),
            pairing: await this.refreshPairingSnapshot()
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (CLIENT_REQUEST_ERRORS.has(message)) {
            this.writeJson(response, 400, {
              error: message
            });
            return;
          }

          throw error;
        }
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/settings/relay") {
        this.writeJson(response, 403, {
          error: "relay_updates_disabled"
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/service/restart") {
        const serviceStatus = this.actions.restartService();
        this.writeJson(response, 200, {
          ok: true,
          service: serviceStatus,
          status: await this.stateService.loadStatus()
        });
        return;
      }

      this.writeJson(response, 404, {
        error: "not_found"
      });
    } catch (error) {
      this.logger.error("local panel request failed", {
        path: request.url ?? "/",
        message: error instanceof Error ? error.message : String(error)
      });
      this.writeJson(response, 500, {
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      await this.stateService.touchHeartbeat();
    }
  }

  private async readJsonBody(request: IncomingMessage): Promise<JsonObject> {
    const chunks: Buffer[] = [];

    await new Promise<void>((resolve, reject) => {
      request.on("data", (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      request.on("end", () => resolve());
      request.on("error", reject);
    });

    if (chunks.length === 0) {
      return {};
    }

    const raw = Buffer.concat(chunks).toString("utf8").trim();
    if (raw.length === 0) {
      return {};
    }

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("request body must be a JSON object");
    }

    return parsed as JsonObject;
  }

  private writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
    response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(body));
  }

  private bindProcessCleanup(): void {
    if (this.cleanupHandlersBound) {
      return;
    }

    process.on("SIGINT", this.handleSigint);
    process.on("SIGTERM", this.handleSigterm);
    this.cleanupHandlersBound = true;
  }

  private unbindProcessCleanup(): void {
    if (!this.cleanupHandlersBound) {
      return;
    }

    process.off("SIGINT", this.handleSigint);
    process.off("SIGTERM", this.handleSigterm);
    this.cleanupHandlersBound = false;
  }

  private async shutdownForSignal(exitCode: number): Promise<void> {
    try {
      await this.stop();
    } catch (error) {
      this.logger.warn("failed to stop local panel cleanly during signal handling", {
        message: error instanceof Error ? error.message : String(error)
      });
    } finally {
      process.exit(exitCode);
    }
  }
}
