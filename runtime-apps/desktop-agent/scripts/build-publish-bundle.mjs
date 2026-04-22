import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDir, "..");
const distEntry = path.join(projectRoot, "dist", "main.js");
const releaseDir = path.join(projectRoot, "release");

rmSync(releaseDir, { recursive: true, force: true });
mkdirSync(releaseDir, { recursive: true });

await build({
  entryPoints: [distEntry],
  outfile: path.join(releaseDir, "main.js"),
  bundle: true,
  external: ["qrcode", "ws"],
  platform: "node",
  format: "esm",
  target: "node18",
  logLevel: "info"
});

copyFileSync(path.join(projectRoot, "src", "local-panel", "favicon.ico"), path.join(releaseDir, "favicon.ico"));
