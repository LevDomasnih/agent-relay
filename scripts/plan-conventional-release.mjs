#!/usr/bin/env node
import { execFileSync } from "node:child_process";

const baseTag = getLatestReleaseTag();
const range = baseTag ? `${baseTag}..HEAD` : "HEAD";
const commits = getCommitMessages(range);
const plan = planRelease(commits);

console.log(
  JSON.stringify(
    {
      baseTag,
      release: plan.bump !== "none",
      bump: plan.bump,
      commits: plan.commits,
    },
    null,
    2,
  ),
);

function getLatestReleaseTag() {
  try {
    return execFileSync(
      "git",
      ["describe", "--tags", "--abbrev=0", "--match", "v[0-9]*"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();
  } catch {
    return null;
  }
}

function getCommitMessages(commitRange) {
  const output = execFileSync("git", ["log", "--format=%B%x1e", commitRange], {
    encoding: "utf8",
  });

  return output
    .split("\x1e")
    .map((message) => message.trim())
    .filter(Boolean);
}

function planRelease(messages) {
  let bump = "none";
  const releaseCommits = [];

  for (const message of messages) {
    const subject = message.split("\n", 1)[0] ?? "";
    const commitBump = classifyCommit(subject, message);

    if (commitBump === "none") {
      continue;
    }

    releaseCommits.push({ subject, bump: commitBump });
    bump = maxBump(bump, commitBump);
  }

  return { bump, commits: releaseCommits };
}

function classifyCommit(subject, message) {
  if (
    /^\w+(?:\([^)]+\))?!:/.test(subject) ||
    /BREAKING CHANGE:/m.test(message)
  ) {
    return "major";
  }

  if (/^feat(?:\([^)]+\))?:/.test(subject)) {
    return "minor";
  }

  if (/^(?:fix|perf)(?:\([^)]+\))?:/.test(subject)) {
    return "patch";
  }

  return "none";
}

function maxBump(current, next) {
  const order = new Map([
    ["none", 0],
    ["patch", 1],
    ["minor", 2],
    ["major", 3],
  ]);

  return order.get(next) > order.get(current) ? next : current;
}
