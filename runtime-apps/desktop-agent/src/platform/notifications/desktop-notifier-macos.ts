import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { DesktopNotifier, DesktopNotificationInput } from "./desktop-notifier.js";

const execFileAsync = promisify(execFile);

function escapeAppleScriptString(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

export class MacOSDesktopNotifier implements DesktopNotifier {
  public async notify(input: DesktopNotificationInput): Promise<void> {
    const subtitlePart = input.subtitle
      ? ` subtitle "${escapeAppleScriptString(input.subtitle)}"`
      : "";
    const script =
      `display notification "${escapeAppleScriptString(input.message)}"` +
      ` with title "${escapeAppleScriptString(input.title)}"${subtitlePart}`;

    await execFileAsync("osascript", ["-e", script]);
  }
}
