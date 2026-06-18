#!/usr/bin/env node
// Fetch subscription usage limits from TokenTracker's usage-limits module and
// print a human-readable report or write a SupaBrain-ready markdown file.
//
// Usage:
//   node scripts/fetch-usage-limits.js
//   node scripts/fetch-usage-limits.js --json
//   node scripts/fetch-usage-limits.js --markdown > usage-limits.md

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { getUsageLimits, resetUsageLimitsCache } = require("../src/lib/usage-limits");

const MANUAL_LIMITS_PATH = path.resolve(__dirname, "..", "config", "tool-limits.json");
const HOME = os.homedir();

function loadManualLimits() {
  try {
    const raw = fs.readFileSync(MANUAL_LIMITS_PATH, "utf8");
    const parsed = JSON.parse(raw);
    delete parsed._meta;
    return parsed;
  } catch (_e) {
    return {};
  }
}

function isDroidInstalled() {
  return fs.existsSync(path.join(HOME, ".factory", "sessions"));
}

function isOpencodeInstalled() {
  return fs.existsSync(path.join(HOME, ".opencode")) || fs.existsSync(path.join(HOME, ".local", "share", "opencode"));
}

function isGrokInstalled() {
  return fs.existsSync(path.join(HOME, ".grok"));
}

function isHermesInstalled() {
  return fs.existsSync(path.join(HOME, ".hermes"));
}

const INSTALL_CHECKERS = {
  droid: isDroidInstalled,
  opencode: isOpencodeInstalled,
  grok: isGrokInstalled,
  hermes: isHermesInstalled,
};

function buildPassiveProviders() {
  const limits = loadManualLimits();
  const out = {};
  for (const [tool, cfg] of Object.entries(limits)) {
    const installed = INSTALL_CHECKERS[tool]?.() || false;
    out[tool] = {
      configured: installed,
      error: installed ? null : "not installed",
      plan_label: cfg.plan || "unknown",
      monthly_cost_usd: cfg.monthly_cost_usd ?? null,
      monthly_token_cap: cfg.monthly_token_cap ?? null,
      monthly_et_cap: cfg.monthly_et_cap ?? null,
      notes: cfg.notes || null,
      _manual: true,
    };
  }
  return out;
}

function pctBar(pct, width = 20) {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return "[unknown]";
  const clamped = Math.max(0, Math.min(100, pct));
  const filled = Math.round((clamped / 100) * width);
  const empty = width - filled;
  return "[" + "█".repeat(filled) + "░".repeat(empty) + "]";
}

function statusEmoji(pct) {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return "⚪";
  if (pct >= 100) return "🔴";
  if (pct >= 90) return "🟠";
  if (pct >= 75) return "🟡";
  return "🟢";
}

function formatWindow(name, window) {
  if (!window) return `  ${name}: not available`;
  const pct = window.used_percent;
  const resetAt = window.reset_at ? new Date(window.reset_at).toLocaleString() : "unknown";
  return `  ${name}: ${statusEmoji(pct)} ${pct != null ? pct.toFixed(1) : "?"}% ${pctBar(pct)} (resets ${resetAt})`;
}

function formatProvider(name, data) {
  const lines = [];
  const label = data.plan_label || name;
  if (data.configured === false) {
    lines.push(`${name} (${label}): not configured`);
    return lines;
  }
  if (data.error) {
    lines.push(`${name} (${label}): ⚠️ ${data.error}`);
    return lines;
  }
  lines.push(`${name} (${label}):`);
  if (data.primary_window) lines.push(formatWindow("primary", data.primary_window));
  if (data.secondary_window) lines.push(formatWindow("secondary", data.secondary_window));
  if (data.tertiary_window) lines.push(formatWindow("tertiary", data.tertiary_window));
  if (data.five_hour) lines.push(formatWindow("5-hour", data.five_hour));
  if (data.seven_day) lines.push(formatWindow("7-day", data.seven_day));
  if (data.seven_day_opus) lines.push(formatWindow("7-day Opus", data.seven_day_opus));
  if (data.extra_usage != null) lines.push(`  extra usage: ${data.extra_usage}`);
  if (data._manual) {
    if (data.monthly_cost_usd != null) lines.push(`  monthly cost: $${data.monthly_cost_usd}`);
    if (data.monthly_token_cap != null) lines.push(`  monthly token cap: ${data.monthly_token_cap.toLocaleString()}`);
    if (data.monthly_et_cap != null) lines.push(`  monthly ET cap: ${data.monthly_et_cap.toLocaleString()}`);
    if (data.notes) lines.push(`  note: ${data.notes}`);
  }
  return lines;
}

function toMarkdown(data) {
  const lines = [
    "---",
    "type: tracker",
    "tags: [tokens, usage, limits, subscriptions, tokentracker]",
    "license: MIT",
    "---",
    "",
    "# Usage Limits Snapshot",
    "",
    `*Fetched at: ${data.fetched_at}*`,
    "",
    "| Provider | Plan | Window | Used % | Resets | Status |",
    "|----------|------|--------|--------|--------|--------|",
  ];
  for (const [name, provider] of Object.entries(data)) {
    if (name === "fetched_at") continue;
    const plan = provider.plan_label || (provider.configured === false ? "not configured" : "unknown");
    if (provider._manual) {
      const cap = provider.monthly_token_cap != null ? `${provider.monthly_token_cap.toLocaleString()} tokens/mo` : provider.monthly_et_cap != null ? `${provider.monthly_et_cap.toLocaleString()} ET/mo` : "manual cap";
      const status = provider.configured ? `manual — ${cap}` : "not installed";
      lines.push(`| ${name} | ${plan} | — | — | — | ${status} |`);
      continue;
    }
    if (provider.error) {
      lines.push(`| ${name} | ${plan} | — | — | — | ⚠️ ${provider.error} |`);
      continue;
    }
    if (provider.configured === false) {
      lines.push(`| ${name} | ${plan} | — | — | — | not configured |`);
      continue;
    }
    const windows = [
      ["primary", provider.primary_window],
      ["secondary", provider.secondary_window],
      ["tertiary", provider.tertiary_window],
      ["5-hour", provider.five_hour],
      ["7-day", provider.seven_day],
      ["7-day Opus", provider.seven_day_opus],
    ].filter(([, w]) => w && w.used_percent != null);
    if (windows.length === 0) {
      lines.push(`| ${name} | ${plan} | — | — | — | no windows |`);
      continue;
    }
    for (const [i, [winName, window]] of windows.entries()) {
      const pct = window.used_percent.toFixed(1);
      const reset = window.reset_at ? new Date(window.reset_at).toLocaleString() : "unknown";
      const status = window.used_percent >= 100 ? "🔴 over" : window.used_percent >= 90 ? "🟠 critical" : window.used_percent >= 75 ? "🟡 warning" : "🟢 ok";
      const providerCell = i === 0 ? name : "";
      const planCell = i === 0 ? plan : "";
      lines.push(`| ${providerCell} | ${planCell} | ${winName} | ${pct}% | ${reset} | ${status} |`);
    }
  }
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push("- **Cursor**: primary = included total usage; tertiary = included API usage (100% = into on-demand).");
  lines.push("- **Claude**: requires a fresh OAuth token; run `claude` once if limits show an auth error.");
  lines.push("- **Codex**: ChatGPT Plus includes a 5-hour rolling window plus a weekly window.");
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes("--json");
  const asMarkdown = args.includes("--markdown");
  const refresh = args.includes("--refresh");
  const outputArg = args.find((a) => a.startsWith("--output="));
  const outputPath = outputArg ? outputArg.slice("--output=".length) : null;

  if (refresh) resetUsageLimitsCache();

  const data = await getUsageLimits({});
  const passive = buildPassiveProviders();
  for (const [tool, provider] of Object.entries(passive)) {
    if (data[tool]) {
      data[tool] = { ...data[tool], ...provider };
    } else {
      data[tool] = provider;
    }
  }

  if (asJson) {
    const out = JSON.stringify(data, null, 2) + "\n";
    if (outputPath) {
      require("node:fs").writeFileSync(outputPath, out, "utf8");
      console.log(`Wrote ${outputPath}`);
    } else {
      process.stdout.write(out);
    }
    return;
  }

  if (asMarkdown) {
    const out = toMarkdown(data);
    if (outputPath) {
      require("node:fs").writeFileSync(outputPath, out, "utf8");
      console.log(`Wrote ${outputPath}`);
    } else {
      process.stdout.write(out);
    }
    return;
  }

  console.log(`Usage limits (fetched ${data.fetched_at})\n`);
  for (const [name, provider] of Object.entries(data)) {
    if (name === "fetched_at") continue;
    console.log(formatProvider(name, provider).join("\n"));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
