#!/usr/bin/env node
// Backfill the quality-per-dollar NUMERATOR from merged GitHub PRs.
//
// Each merged PR = one accepted outcome (it passed human review). This gives
// the metric real data today without changing your workflow. Going forward,
// agents (e.g. spec-to-ship) emit richer per-model outcome events directly.
//
// Note: historical PRs can't be attributed to a builder model, so backfilled
// outcomes power the PORTFOLIO quality-per-dollar, not the per-model split.
//
// Usage: node scripts/backfill-outcomes-from-github.cjs [author] [limit]
//   author defaults to @me, limit defaults to 200.

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { resolveTrackerPaths } = require("../src/lib/tracker-paths");

async function main() {
  const author = process.argv[2] || "@me";
  const limit = process.argv[3] || "200";

  let raw;
  try {
    raw = execFileSync(
      "gh",
      ["search", "prs", "--author", author, "--merged", "--limit", String(limit),
       "--json", "number,repository,title,closedAt,url"],
      { encoding: "utf8" },
    );
  } catch (e) {
    console.error("gh search failed — is the GitHub CLI installed and authed?\n" + (e.stderr || e.message));
    process.exit(1);
  }

  const prs = JSON.parse(raw);
  const paths = await resolveTrackerPaths();
  fs.mkdirSync(paths.trackerDir, { recursive: true });
  const file = path.join(paths.trackerDir, "outcomes.jsonl");

  // De-dup against anything already backfilled (idempotent re-runs).
  const seen = new Set();
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const t = line.trim();
      if (!t) continue;
      try { seen.add(JSON.parse(t).story_id); } catch { /* skip */ }
    }
  }

  const records = [];
  for (const p of prs) {
    const repo = p.repository?.nameWithOwner || p.repository?.name || "unknown";
    const id = `${repo}#${p.number}`;
    if (seen.has(id)) continue;
    records.push({
      story_id: id,
      accepted: true,
      review_verdict: "passed",
      iterations: null,        // unknown for historical PRs
      model: null,             // unknown — powers portfolio metric, not per-model
      net_loc_delta: null,     // diagnostic only; not available from search
      source: "github-pr-backfill",
      url: p.url,
      title: p.title,
      finished_at: p.closedAt, // merged PRs: closedAt == merge time
    });
  }

  if (records.length) {
    fs.appendFileSync(file, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
  }
  console.log(
    `Backfilled ${records.length} merged PRs as accepted outcomes (${seen.size} already present) -> ${file}`,
  );
}

main();
