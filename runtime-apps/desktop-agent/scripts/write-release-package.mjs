import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDir, "..");
const releaseDir = path.join(projectRoot, "release");

const sourcePackage = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8"));
const releaseDependencies = Object.fromEntries(
  Object.entries(sourcePackage.dependencies ?? {}).filter(([name]) => !name.startsWith("@kodexlink/"))
);

const releasePackage = {
  name: sourcePackage.name,
  version: sourcePackage.version,
  description: "KodexLink desktop agent CLI",
  type: "module",
  scripts: {
    postinstall:
      "node -e \"console.log('Run: kodexlink start')\""
  },
  bin: {
    kodexlink: "main.js"
  },
  main: "main.js",
  engines: {
    node: ">=18"
  },
  keywords: ["kodexlink", "codex", "cli", "desktop", "agent", "macos", "windows", "linux"],
  publishConfig: {
    access: "public"
  },
  ...(Object.keys(releaseDependencies).length > 0 ? { dependencies: releaseDependencies } : {})
};

mkdirSync(releaseDir, { recursive: true });
writeFileSync(path.join(releaseDir, "package.json"), `${JSON.stringify(releasePackage, null, 2)}\n`, "utf8");
copyFileSync(path.join(projectRoot, "README.md"), path.join(releaseDir, "README.md"));
