// Quality-per-dollar engine.
//
// Numerator: accepted, gate-passing outcomes (read from outcomes.jsonl, the
// vendor-neutral interface; see QUALITY-PER-DOLLAR.md). NEVER lines of code.
// Denominator: effective $ — at-list token cost (computeRowCost), or a
// user-declared subscription total prorated over the window.
//
// Outcomes are OPTIONAL: with none, this still returns cost (graceful
// degrade). With them, it returns quality per dollar.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ensurePricingLoaded, computeRowCost } = require("./pricing");
const { resolveTrackerPaths } = require("./tracker-paths");

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  const out = [];
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t));
    } catch {
      /* skip malformed line */
    }
  }
  return out;
}

function dayOf(ts) {
  return typeof ts === "string" ? ts.slice(0, 10) : "";
}

function inDayWindow(day, from, to) {
  if (!day) return false;
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}

async function computeQualityPerDollar({ home, from, to, subscriptionMonthlyUsd } = {}) {
  await ensurePricingLoaded();
  const paths = await resolveTrackerPaths({ home: home || os.homedir() });
  const queue = readJsonl(path.join(paths.trackerDir, "queue.jsonl"));
  const outcomes = readJsonl(path.join(paths.trackerDir, "outcomes.jsonl"));

  // --- denominator: at-list cost per model, within the day window ---
  let listCost = 0;
  let windowStart = null;
  let windowEnd = null;
  const costByModel = new Map();
  for (const r of queue) {
    const day = dayOf(r.hour_start);
    if (!inDayWindow(day, from, to)) continue;
    if (!windowStart || r.hour_start < windowStart) windowStart = r.hour_start;
    if (!windowEnd || r.hour_start > windowEnd) windowEnd = r.hour_start;
    const cost = computeRowCost(r);
    listCost += cost;
    const key = r.model || "unknown";
    const m =
      costByModel.get(key) ||
      { model: key, list_cost: 0, total_tokens: 0, cached_input_tokens: 0 };
    m.list_cost += cost;
    m.total_tokens += r.total_tokens || 0;
    m.cached_input_tokens += r.cached_input_tokens || 0;
    costByModel.set(key, m);
  }

  // --- numerator: accepted outcomes within the window ---
  const accepted = outcomes.filter(
    (o) => o.accepted === true && (!o.finished_at || inDayWindow(dayOf(o.finished_at), from, to)),
  );
  const acceptedByModel = new Map();
  let iterationsSum = 0;
  let iterationsCount = 0;
  for (const o of accepted) {
    const m = o.builder_model || o.model;
    if (m) acceptedByModel.set(m, (acceptedByModel.get(m) || 0) + 1);
    if (typeof o.iterations === "number") {
      iterationsSum += o.iterations;
      iterationsCount += 1;
    }
  }
  const acceptedTotal = accepted.length;

  // --- effective $: subscription (prorated) if declared, else at-list ---
  const days =
    windowStart && windowEnd
      ? Math.max(1, Math.round((Date.parse(windowEnd) - Date.parse(windowStart)) / 86_400_000) + 1)
      : 0;
  let effectiveUsd = listCost;
  let basis = "list_price";
  if (subscriptionMonthlyUsd && days) {
    effectiveUsd = subscriptionMonthlyUsd * (days / 30);
    basis = "subscription";
  }

  const perModel = Array.from(costByModel.values())
    .map((m) => {
      const acc = acceptedByModel.get(m.model) || 0;
      return {
        model: m.model,
        list_cost_usd: Number(m.list_cost.toFixed(4)),
        total_tokens: m.total_tokens,
        cache_pct: m.total_tokens
          ? Number(((100 * m.cached_input_tokens) / m.total_tokens).toFixed(1))
          : 0,
        accepted_outcomes: acc,
        dollars_per_accepted: acc ? Number((m.list_cost / acc).toFixed(4)) : null,
      };
    })
    .sort((a, b) => b.list_cost_usd - a.list_cost_usd);

  return {
    window: { from: windowStart, to: windowEnd, days },
    denominator: {
      basis,
      effective_usd: Number(effectiveUsd.toFixed(2)),
      list_price_usd: Number(listCost.toFixed(2)),
      subscription_monthly_usd: subscriptionMonthlyUsd || null,
    },
    numerator: {
      accepted_outcomes: acceptedTotal,
      model_tagged: Array.from(acceptedByModel.values()).reduce((a, b) => a + b, 0),
      avg_iterations: iterationsCount ? Number((iterationsSum / iterationsCount).toFixed(2)) : null,
    },
    quality_per_dollar: {
      // The headline. Lower $/outcome is better.
      dollars_per_accepted_outcome: acceptedTotal ? Number((effectiveUsd / acceptedTotal).toFixed(2)) : null,
      accepted_outcomes_per_1k_usd: effectiveUsd ? Number(((acceptedTotal / effectiveUsd) * 1000).toFixed(2)) : null,
    },
    per_model: perModel,
  };
}

module.exports = { computeQualityPerDollar, readJsonl };
