import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { getPlatformId } from "./platform-id.js";

const execFileAsync = promisify(execFile);

export async function openExternalUrl(url: string, rawPlatform: NodeJS.Platform = process.platform): Promise<void> {
  switch (getPlatformId(rawPlatform)) {
    case "macos":
      await execFileAsync("open", [url]);
      return;
    case "windows":
      await execFileAsync("cmd", ["/c", "start", "", url]);
      return;
    case "linux":
      await execFileAsync("xdg-open", [url]);
      return;
    default:
      throw new Error("opening the browser is not supported on this platform");
  }
}
