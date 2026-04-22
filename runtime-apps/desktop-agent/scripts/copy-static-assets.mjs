import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDir, "..");

const assets = [
  {
    source: path.join(projectRoot, "src", "local-panel", "favicon.ico"),
    target: path.join(projectRoot, "dist", "local-panel", "favicon.ico")
  }
];

for (const asset of assets) {
  mkdirSync(path.dirname(asset.target), { recursive: true });
  copyFileSync(asset.source, asset.target);
}
