#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";

const releaseType = process.argv[2] ?? "patch";
const allowedReleaseTypes = new Set(["patch", "minor", "major"]);

if (!allowedReleaseTypes.has(releaseType)) {
  console.error(`Unsupported release type: ${releaseType}`);
  process.exit(1);
}

const packageJsonPaths = [
  "package.json",
  "packages/core/package.json",
  "packages/cli/package.json",
  "packages/mcp-server/package.json",
];

const lockfilePath = "pnpm-lock.yaml";

const rootPackage = JSON.parse(await readFile("package.json", "utf8"));
const nextVersion = bumpVersion(rootPackage.version, releaseType);

for (const packageJsonPath of packageJsonPaths) {
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  packageJson.version = nextVersion;

  if (packageJson.dependencies?.["@agent-relay/core"]) {
    packageJson.dependencies["@agent-relay/core"] = nextVersion;
  }

  await writeJson(packageJsonPath, packageJson);
}

let lockfile = await readFile(lockfilePath, "utf8");
lockfile = lockfile.replaceAll(rootPackage.version, nextVersion);
await writeFile(lockfilePath, lockfile);

console.log(nextVersion);

function bumpVersion(version, type) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);

  if (!match) {
    throw new Error(`Unsupported semver version: ${version}`);
  }

  let major = Number(match[1]);
  let minor = Number(match[2]);
  let patch = Number(match[3]);

  if (type === "major") {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (type === "minor") {
    minor += 1;
    patch = 0;
  } else {
    patch += 1;
  }

  return `${major}.${minor}.${patch}`;
}

async function writeJson(path, value) {
  await writeFile(`${path}`, `${JSON.stringify(value, null, 2)}\n`);
}
