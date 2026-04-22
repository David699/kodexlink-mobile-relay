import readline from "node:readline";

import { formatPairingCountdown, getPairingExpiryState } from "./pairing-expiry.js";

export interface TerminalPairingCountdownHandle {
  stop(): void;
}

interface TerminalPairingCountdownOptions {
  expiresAt: number;
  stream?: NodeJS.WriteStream;
}

function renderCountdownText(expiresAt: number): { text: string; isExpired: boolean } {
  const expiry = getPairingExpiryState(expiresAt);
  if (expiry.isExpired) {
    return {
      text: "QR code countdown: EXPIRED",
      isExpired: true
    };
  }

  return {
    text: `QR code countdown: ${formatPairingCountdown(expiry.remainingMs)} remaining`,
    isExpired: false
  };
}

export function startTerminalPairingCountdown(
  options: TerminalPairingCountdownOptions
): TerminalPairingCountdownHandle {
  const stream = options.stream ?? process.stdout;
  if (!stream.isTTY) {
    return {
      stop() {}
    };
  }

  let hasRenderedLine = false;
  let stopped = false;

  const render = (): void => {
    if (stopped) {
      return;
    }

    const countdown = renderCountdownText(options.expiresAt);
    if (!hasRenderedLine) {
      stream.write(`${countdown.text}\n`);
      hasRenderedLine = true;
    } else {
      readline.moveCursor(stream, 0, -1);
      readline.clearLine(stream, 0);
      readline.cursorTo(stream, 0);
      stream.write(`${countdown.text}\n`);
    }

    if (countdown.isExpired) {
      stop();
    }
  };

  const timer = setInterval(render, 1000);
  timer.unref?.();
  render();

  const stop = (): void => {
    if (stopped) {
      return;
    }

    stopped = true;
    clearInterval(timer);
  };

  return { stop };
}
