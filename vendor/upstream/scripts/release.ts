#!/usr/bin/env node
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, globSync } from "node:fs";
import { resolve } from "node:path";

const rootDir = resolve(import.meta.dirname, "..");
const pkgPath = resolve(rootDir, "package.json");

const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const currentVersion = pkg.version;

const bumpType = (process.argv[2] || "patch") as "major" | "minor" | "patch";

const [major, minor, patch] = currentVersion.split(".").map(Number);
const nextVersion =
  bumpType === "major"
    ? `${major + 1}.0.0`
    : bumpType === "minor"
      ? `${major}.${minor + 1}.0`
      : `${major}.${minor}.${patch + 1}`;

console.log(`Bumping version: ${currentVersion} → ${nextVersion} (${bumpType})`);

pkg.version = nextVersion;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

const run = (cmd: string) => {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { cwd: rootDir, stdio: "inherit" });
};

const isLocal = process.argv.includes("--local");

// Clean old .vsix files
for (const vsix of globSync("*.vsix", { cwd: rootDir })) {
  console.log(`Removing old ${vsix}`);
  execSync(`rm ${vsix}`, { cwd: rootDir });
}

// Package once
run("pnpm package");

const [vsixFile] = globSync("*.vsix", { cwd: rootDir });
if (!vsixFile) {
  console.error("❌ No .vsix file found after packaging");
  process.exit(1);
}

// Git tag and push (CI handles publishing)
run(`git add -A`);
run(`git commit -m "v${nextVersion}"`);
run(`git tag v${nextVersion}`);
run(`git push`);
run(`git push --tags`);

// Publish locally if --local flag is passed
if (isLocal) {
  console.log(`\nPublishing ${vsixFile} locally...`);
  run(`vsce publish --no-dependencies -i ${vsixFile}`);
  run(`ovsx publish ${vsixFile}`);
}

console.log(`\n✅ Released v${nextVersion}`);
