import { readFileSync } from "node:fs";

let cachedFavicon: Buffer | null = null;

export function getLocalPanelFavicon(): Buffer {
  if (cachedFavicon) {
    return cachedFavicon;
  }

  cachedFavicon = readFileSync(new URL("./favicon.ico", import.meta.url));
  return cachedFavicon;
}
