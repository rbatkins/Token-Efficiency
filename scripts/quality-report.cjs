#!/usr/bin/env node
// Print the quality-per-dollar report from your local tracker data.
//
// Usage: node scripts/quality-report.cjs [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--sub <monthlyUSD>]

const { computeQualityPerDollar } = require("../src/lib/quality");

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const r = await computeQualityPerDollar({
    from: arg("--from"),
    to: arg("--to"),
    subscriptionMonthlyUsd: arg("--sub") ? Number(arg("--sub")) : undefined,
  });

  const qpd = r.quality_per_dollar;
  console.log("\n  QUALITY PER DOLLAR");
  console.log("  ──────────────────");
  console.log(`  window           ${r.window.from?.slice(0,10)} → ${r.window.to?.slice(0,10)}  (${r.window.days}d)`);
  console.log(`  denominator      $${r.denominator.effective_usd}  (${r.denominator.basis}${r.denominator.basis === "subscription" ? `, $${r.denominator.subscription_monthly_usd}/mo` : ""})`);
  console.log(`    at-list ref    $${r.denominator.list_price_usd}`);
  console.log(`  accepted outcomes ${r.numerator.accepted_outcomes}  (model-tagged: ${r.numerator.model_tagged}, avg iterations: ${r.numerator.avg_iterations ?? "n/a"})`);
  console.log(`  ▶ $ / accepted    ${qpd.dollars_per_accepted_outcome ?? "n/a (no outcomes — run backfill)"}`);
  console.log(`  ▶ accepted / $1k  ${qpd.accepted_outcomes_per_1k_usd ?? "n/a"}`);

  console.log("\n  PER MODEL (cost + cache% ; $/accepted needs model-tagged outcomes)");
  console.log("  " + "model".padEnd(22) + "list $".padStart(10) + "cache%".padStart(8) + "accepted".padStart(10) + "$/acc".padStart(10));
  for (const m of r.per_model.slice(0, 14)) {
    console.log(
      "  " + String(m.model).padEnd(22) +
      String(m.list_cost_usd.toFixed(2)).padStart(10) +
      String(m.cache_pct).padStart(8) +
      String(m.accepted_outcomes).padStart(10) +
      String(m.dollars_per_accepted ?? "—").padStart(10),
    );
  }
  console.log("");
}

main().catch((e) => { console.error(e); process.exit(1); });
