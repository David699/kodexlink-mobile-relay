const EXPIRING_SOON_MS = 60_000;

export interface PairingExpiryState {
  expiresAt: number;
  remainingMs: number;
  isExpired: boolean;
  isExpiringSoon: boolean;
}

export function normalizePairingExpiresAt(expiresAt: number): number {
  return expiresAt < 10_000_000_000 ? expiresAt * 1000 : expiresAt;
}

export function getPairingExpiryState(
  expiresAt: number,
  now = Date.now()
): PairingExpiryState {
  const normalizedExpiresAt = normalizePairingExpiresAt(expiresAt);
  const remainingMs = Math.max(0, normalizedExpiresAt - now);
  const isExpired = remainingMs <= 0;

  return {
    expiresAt: normalizedExpiresAt,
    remainingMs,
    isExpired,
    isExpiringSoon: !isExpired && remainingMs <= EXPIRING_SOON_MS
  };
}

export function formatPairingCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
