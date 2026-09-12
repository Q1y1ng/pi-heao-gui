import { cpSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Copy renderer placeholder
const rendererSrc = join(root, "src", "renderer");
const rendererDest = join(root, "dist", "renderer");
if (existsSync(rendererSrc)) {
  mkdirSync(rendererDest, { recursive: true });
  cpSync(rendererSrc, rendererDest, { recursive: true });
  console.log("Copied renderer placeholder");
}

console.log("Assets copied");
