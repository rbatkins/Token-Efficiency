# Quality per dollar

> Design doc for Token Efficiency's defining capability: answer **"what did the tokens buy?"** — not just what they cost.

Token Efficiency already tracks the **dollar** side precisely (tokens → cost, across many tools). This doc specifies the **quality** side and the ratio that joins them, as a **generic, agent-agnostic capability** any user can switch on. It is the substance behind the fork's tagline (*quality-per-token / code-quality-per-dollar*).

## The metric

**quality per dollar = accepted, gate-passing units of work ÷ effective $**, per model and per tool.

- The "unit of work" is an **outcome**, never **lines of code**. LOC is the Goodhart trap: the moment "quality" means lines, you reward bloat — the exact thing a good quality gate (e.g. [ponytail](https://github.com/DietrichGebert/ponytail)) exists to prevent. A unit solved by *deleting* code counts the same as any other accepted unit.
- "effective $" is metered cost — or, if the user declares subscriptions, **cap consumption + overage**. Under a flat-subscription stack the marginal token price isn't the real cost; cap pressure is.

### Effective Tokens (ET)

The same idea, token-side: **ET = tokens that produced accepted work**, as opposed to tokens burned on rework or rejected output. Quality-per-dollar is ET made financial. A high rework ratio (iterations per accepted unit) means a low ET fraction — dollars buying motion, not outcomes. That's the number to drive down.

## Principles (so it's useful to everyone)

- **Works out of the box.** Cost tracking already does; quality-per-dollar is an *optional* layer on top — no required external tooling.
- **Agent-agnostic.** Any harness can feed it: Claude Code, Cursor, Droid, a CI script, even a human marking PRs accepted.
- **Degrades gracefully.** No outcome data → you still get cost (today's behavior). Outcome data present → you also get quality-per-dollar.
- **Nothing hardcoded.** No baked-in plans, subscriptions, or models. Subscription-awareness is *user-declared* config; pricing is table-driven.

## The outcome interface (the numerator input)

A generic, optional, append-only `outcomes.jsonl`. One record per completed unit of work:

```json
{ "accepted": true, "criteria_passed": 3, "criteria_total": 3,
  "review_verdict": "passed", "iterations": 2, "model": "minimax-m3",
  "net_loc_delta": -40 }
```

Vendor-neutral — any producer can emit it. [spec-to-ship](https://github.com/rbatkins/spec-to-ship) is one conforming producer; see its [`outcome-event.json`](https://github.com/rbatkins/spec-to-ship/blob/main/templates/outcome-event.json). `net_loc_delta` is recorded for diagnostics only and read **inversely** (less code for the same outcome = better); it never enters the metric.

## Planned work

1. **Ingest** the optional outcome stream (`outcomes.jsonl`), append-only, sibling of the token queue.
2. **Join** outcomes to token/$ rows by `model` + time window; tolerate missing outcomes (cost-only fallback for users who emit none).
3. **Compute & surface**, per model/tool: quality-per-dollar, rework ratio (the ET fraction), cache-efficiency ($ of cache reads per accepted outcome).
4. **User-declared subscription config** → a subscription-aware denominator (cap saturation %, overage risk). Defaults to metered / none.
5. **Pricing freshness** — curated overrides for current models so the newest tools are costed correctly.

## Non-goals

- Not tied to any one person's data, subscriptions, or model choices — those are just test cases.
- Not coupled to spec-to-ship — it's the reference outcome producer; the capability must work without it.

## Why it matters

- **cost-per-token** → too low (ignores quality)
- **accepted-units-per-dollar** alone → too coarse (ignores how efficiently you got there)
- **quality per dollar, instrumented via ET** → the right altitude: *what fraction of every dollar produced work that survived the gate.*
