import { ERROR_CODES } from "@kodexlink/protocol";
import type { Logger } from "@kodexlink/shared";

export interface AgentAuthState {
  deviceId: string;
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: number;
  refreshExpiresAt: number;
  relayBaseUrl: string;
}

export interface AgentIdentity extends AgentAuthState {
  deviceName: string;
}

export interface AgentIdentityResolution {
  identity: AgentIdentity;
  refreshed: boolean;
}

export interface AgentBootstrapProfile {
  agentId: string;
  deviceName: string;
  authByRelay?: Record<string, AgentAuthState>;
}

export interface PairingPayload {
  v: 1;
  relayUrl: string;
  pairingId: string;
  pairingSecret: string;
  agentLabel: string;
  expiresAt: number;
}

interface BootstrapResponse {
  deviceId: string;
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: number;
  refreshExpiresAt: number;
  relayUrl: string;
}

interface RelayErrorResponse {
  code?: string;
  message?: string;
}

class RelayHttpError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: string | undefined,
    message: string
  ) {
    super(message);
    this.name = "RelayHttpError";
  }

  public get isCredentialRejected(): boolean {
    return (
      this.code === ERROR_CODES.unauthorized ||
      this.code === ERROR_CODES.authFailed ||
      this.code === ERROR_CODES.tokenExpired ||
      this.code === ERROR_CODES.tokenRevoked
    );
  }
}

function toRelayHttpBaseUrl(relayWebSocketUrl: string): string {
  const url = new URL(relayWebSocketUrl);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function nowInSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function toAgentIdentity(
  payload: BootstrapResponse,
  deviceName: string
): AgentIdentity {
  return {
    deviceId: payload.deviceId,
    accessToken: payload.accessToken,
    refreshToken: payload.refreshToken,
    accessExpiresAt: payload.accessExpiresAt,
    refreshExpiresAt: payload.refreshExpiresAt,
    relayBaseUrl: payload.relayUrl,
    deviceName
  };
}

export class PairingManager {
  public constructor(
    private readonly relayWebSocketUrl: string,
    private readonly logger: Logger
  ) {}

  public async ensureAgentIdentity(
    profile: AgentBootstrapProfile
  ): Promise<AgentIdentityResolution> {
    const relayBaseUrl = toRelayHttpBaseUrl(this.relayWebSocketUrl);
    const existingAuth = profile.authByRelay?.[relayBaseUrl];

    if (existingAuth) {
      const existingIdentity: AgentIdentity = {
        ...existingAuth,
        deviceName: profile.deviceName
      };

      if (existingIdentity.accessExpiresAt > nowInSeconds()) {
        this.logger.info("reusing persisted agent identity", {
          deviceId: existingIdentity.deviceId,
          relayBaseUrl
        });
        return {
          identity: existingIdentity,
          refreshed: false
        };
      }

      if (existingIdentity.refreshExpiresAt > nowInSeconds()) {
        try {
          const refreshedIdentity = await this.refreshAgentIdentity(existingIdentity);
          return {
            identity: refreshedIdentity,
            refreshed: true
          };
        } catch (error) {
          if (!(error instanceof RelayHttpError) || !error.isCredentialRejected) {
            throw error;
          }

          this.logger.warn("persisted agent refresh token rejected; falling back to bootstrap", {
            deviceId: existingIdentity.deviceId,
            status: error.status,
            code: error.code
          });
        }
      }
    }

    const bootstrappedIdentity = await this.bootstrapAgentIdentity({
      agentId: profile.agentId,
      deviceName: profile.deviceName
    });
    return {
      identity: bootstrappedIdentity,
      refreshed: true
    };
  }

  public async createPairingSession(
    identity: AgentIdentity,
    agentLabel?: string
  ): Promise<PairingPayload> {
    await this.ensureFreshAccessToken(identity);

    this.logger.info("creating pairing session", {
      agentId: identity.deviceId
    });

    const response = await fetch(`${identity.relayBaseUrl}/v1/pairings`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-device-id": identity.deviceId,
        "x-device-token": identity.accessToken
      },
      body: JSON.stringify({
        agentLabel: agentLabel ?? identity.deviceName
      })
    });

    if (!response.ok) {
      throw await this.readRelayError(response, "failed to create pairing session");
    }

    return (await response.json()) as PairingPayload;
  }

  private async bootstrapAgentIdentity(
    profile: Pick<AgentBootstrapProfile, "agentId" | "deviceName">
  ): Promise<AgentIdentity> {
    const relayBaseUrl = toRelayHttpBaseUrl(this.relayWebSocketUrl);
    const response = await fetch(`${relayBaseUrl}/v1/agents/bootstrap`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        deviceId: profile.agentId,
        deviceName: profile.deviceName
      })
    });

    if (!response.ok) {
      throw await this.readRelayError(response, "failed to bootstrap agent identity");
    }

    const payload = (await response.json()) as BootstrapResponse;
    this.logger.info("agent identity bootstrapped", {
      deviceId: payload.deviceId,
      relayBaseUrl: payload.relayUrl
    });
    return toAgentIdentity(payload, profile.deviceName);
  }

  private async refreshAgentIdentity(identity: AgentIdentity): Promise<AgentIdentity> {
    const response = await fetch(`${identity.relayBaseUrl}/v1/token/refresh`, {
      method: "POST",
      headers: {
        "x-device-id": identity.deviceId,
        "x-refresh-token": identity.refreshToken
      }
    });

    if (!response.ok) {
      throw await this.readRelayError(response, "failed to refresh agent identity");
    }

    const payload = (await response.json()) as BootstrapResponse;
    this.logger.info("agent identity refreshed", {
      deviceId: payload.deviceId,
      relayBaseUrl: payload.relayUrl
    });
    return toAgentIdentity(payload, identity.deviceName);
  }

  private async ensureFreshAccessToken(identity: AgentIdentity): Promise<void> {
    const now = nowInSeconds();
    if (identity.accessExpiresAt > now + 300) {
      return;
    }

    if (identity.refreshExpiresAt <= now) {
      if (identity.accessExpiresAt > now) {
        return;
      }

      throw new Error(
        "The agent access token has expired and the refresh token is unavailable. Restart desktop-agent or run a dev reset."
      );
    }

    const refreshedIdentity = await this.refreshAgentIdentity(identity);
    identity.accessToken = refreshedIdentity.accessToken;
    identity.refreshToken = refreshedIdentity.refreshToken;
    identity.accessExpiresAt = refreshedIdentity.accessExpiresAt;
    identity.refreshExpiresAt = refreshedIdentity.refreshExpiresAt;
    identity.relayBaseUrl = refreshedIdentity.relayBaseUrl;
  }

  private async readRelayError(
    response: Response,
    fallbackMessage: string
  ): Promise<RelayHttpError> {
    let payload: RelayErrorResponse | null = null;
    try {
      payload = (await response.json()) as RelayErrorResponse;
    } catch {
      payload = null;
    }

    const message = payload?.message ?? `${fallbackMessage}: ${response.status}`;
    return new RelayHttpError(response.status, payload?.code, message);
  }
}
