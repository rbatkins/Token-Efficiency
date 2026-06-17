#!/usr/bin/env python3
"""Sync TokenTracker usage data to a SupaBrain markdown page.

Reads ~/.tokentracker/tracker/queue.jsonl and project.queue.jsonl, computes
Effective Tokens (ET) using the GitHub token-efficiency formula, and writes a
SupaBrain-compatible markdown file that can be ingested with:

    gbrain capture --file token-efficiency-supabrain.md --slug token-tracker

Run from the repo root:

    python scripts/sync-to-supabrain.py
"""

from __future__ import annotations

import json
import os
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

TOKENTRACKER_DIR = Path.home() / ".tokentracker" / "tracker"
QUEUE_FILE = TOKENTRACKER_DIR / "queue.jsonl"
PROJECT_QUEUE_FILE = TOKENTRACKER_DIR / "project.queue.jsonl"
PRICING_FILE = Path.home() / ".tokentracker" / "cache" / "pricing.json"
OUT_FILE = Path("token-efficiency-supabrain.md")


def model_multiplier(model: str) -> float:
    """Approximate cost multiplier relative to a Sonnet-class workhorse model.

    These are deliberately conservative estimates. Exact per-request pricing is
    looked up separately from TokenTracker's cached LiteLLM pricing snapshot.
    """
    m = model.lower()
    if any(x in m for x in ("haiku", "fable-5")) and "thinking" not in m:
        return 0.25
    if any(x in m for x in ("opus-4-8", "opus-4-5", "opus-4-6", "opus-4-7", "4.6-opus")):
        return 5.0
    if "opus" in m:
        return 5.0
    if any(x in m for x in ("sonnet-4", "4.6-sonnet", "claude-4")):
        return 1.0
    if "gpt-5.5-high" in m:
        return 1.2
    if "gpt-5.5-medium" in m:
        return 0.8
    if m.endswith("gpt-5.5"):
        return 1.0
    if "gpt-5.3-codex" in m:
        return 0.6
    if "composer-2.5-fast" in m:
        return 0.4
    return 1.0


def effective_tokens(row: dict[str, Any], multiplier: float) -> float:
    """Compute Effective Tokens using the GitHub agentic-efficiency formula.

    ET = m * (1.0 * I + 0.1 * C + 4.0 * O)

    Where:
        I = newly-processed input tokens
        C = cache-read tokens
        O = output tokens
    """
    return multiplier * (
        1.0 * row.get("input_tokens", 0)
        + 0.1 * row.get("cached_input_tokens", 0)
        + 4.0 * row.get("output_tokens", 0)
    )


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    if not path.exists():
        return rows
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return rows


def load_pricing() -> dict[str, Any]:
    if not PRICING_FILE.exists():
        return {}
    try:
        return json.loads(PRICING_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


def format_usd(n: float) -> str:
    if n == 0:
        return "$0.00"
    if n < 0.01:
        return f"${n:.6f}"
    return f"${n:,.2f}"


def main() -> int:
    if not QUEUE_FILE.exists():
        print(f"TokenTracker queue not found: {QUEUE_FILE}", file=sys.stderr)
        print("Run `npx tokentracker-cli` first to generate local usage data.", file=sys.stderr)
        return 1

    rows = load_jsonl(QUEUE_FILE)
    project_rows = load_jsonl(PROJECT_QUEUE_FILE)
    pricing = load_pricing()

    if not rows:
        print("No usage rows found.", file=sys.stderr)
        return 0

    totals = {
        "input_tokens": sum(r.get("input_tokens", 0) for r in rows),
        "cached_input_tokens": sum(r.get("cached_input_tokens", 0) for r in rows),
        "cache_creation_input_tokens": sum(r.get("cache_creation_input_tokens", 0) for r in rows),
        "output_tokens": sum(r.get("output_tokens", 0) for r in rows),
        "reasoning_output_tokens": sum(r.get("reasoning_output_tokens", 0) for r in rows),
        "total_tokens": sum(r.get("total_tokens", 0) for r in rows),
        "billable_total_tokens": sum(r.get("billable_total_tokens", 0) for r in rows),
        "conversations": sum(r.get("conversation_count", 0) for r in rows),
        "et": sum(effective_tokens(r, model_multiplier(r.get("model", ""))) for r in rows),
    }

    by_source: dict[str, dict[str, Any]] = defaultdict(lambda: {"tokens": 0, "et": 0, "conversations": 0})
    by_model: dict[str, dict[str, Any]] = defaultdict(lambda: {"tokens": 0, "et": 0, "conversations": 0, "buckets": 0})
    by_project: dict[str, dict[str, Any]] = defaultdict(lambda: {"tokens": 0, "et": 0, "conversations": 0})

    for r in rows:
        mult = model_multiplier(r.get("model", ""))
        et = effective_tokens(r, mult)
        src = r.get("source", "unknown")
        model = r.get("model", "unknown")

        by_source[src]["tokens"] += r.get("total_tokens", 0)
        by_source[src]["et"] += et
        by_source[src]["conversations"] += r.get("conversation_count", 0)

        by_model[model]["tokens"] += r.get("total_tokens", 0)
        by_model[model]["et"] += et
        by_model[model]["conversations"] += r.get("conversation_count", 0)
        by_model[model]["buckets"] += 1

    for r in project_rows:
        mult = model_multiplier(r.get("model", ""))
        et = effective_tokens(r, mult)
        key = r.get("project_key", "unknown")
        by_project[key]["tokens"] += r.get("total_tokens", 0)
        by_project[key]["et"] += et
        by_project[key]["conversations"] += r.get("conversation_count", 0)

    sorted_sources = sorted(by_source.items(), key=lambda x: x[1]["tokens"], reverse=True)
    sorted_models = sorted(by_model.items(), key=lambda x: x[1]["tokens"], reverse=True)
    sorted_projects = sorted(by_project.items(), key=lambda x: x[1]["tokens"], reverse=True)

    earliest = min(r.get("hour_start", "9999-12-31") for r in rows)
    latest = max(r.get("hour_start", "0000-01-01") for r in rows)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    # Build markdown
    md = f"""---
type: tracker
tags: [tokens, usage, cost, tracking, tokentracker, efficiency, quality]
license: MIT
---

# Token Efficiency Snapshot

Auto-generated from local TokenTracker data. This page is a rollup designed for
SupaBrain ingestion; the canonical local data stays in `~/.tokentracker/tracker/`.

## Snapshot

| Metric | Value |
|--------|-------|
| **Generated** | {today} |
| **Tracking period** | {earliest[:10]} → {latest[:10]} |
| **Hourly buckets** | {len(rows):,} |
| **Total tokens** | {totals['total_tokens']:,} |
| **Input tokens** | {totals['input_tokens']:,} |
| **Cached input tokens** | {totals['cached_input_tokens']:,} |
| **Cache-creation input tokens** | {totals['cache_creation_input_tokens']:,} |
| **Output tokens** | {totals['output_tokens']:,} |
| **Reasoning output tokens** | {totals['reasoning_output_tokens']:,} |
| **Billable total tokens** | {totals['billable_total_tokens']:,} |
| **Conversations/sessions** | {totals['conversations']:,.0f} |
| **Effective Tokens (ET)** | {totals['et']:,.0f} |
| **Estimated cost** | *pending exact model pricing* |

### By Tool

| Tool | Tokens | ET | Share (Tokens) | Share (ET) |
|------|-------:|---:|---------------:|-----------:|
"""

    for src, data in sorted_sources:
        tok_share = data["tokens"] / totals["total_tokens"] * 100 if totals["total_tokens"] else 0
        et_share = data["et"] / totals["et"] * 100 if totals["et"] else 0
        md += f"| {src} | {data['tokens']:,} | {data['et']:,.0f} | {tok_share:.1f}% | {et_share:.1f}% |\n"

    md += "\n### By Model (top 15)\n\n| Model | Tokens | ET | Buckets | Tok Share | ET Share | Multiplier |\n|-------|-------:|---:|--------:|----------:|---------:|-----------:|\n"
    for model, data in sorted_models[:15]:
        tok_share = data["tokens"] / totals["total_tokens"] * 100 if totals["total_tokens"] else 0
        et_share = data["et"] / totals["et"] * 100 if totals["et"] else 0
        mult = model_multiplier(model)
        md += f"| {model} | {data['tokens']:,} | {data['et']:,.0f} | {data['buckets']:,} | {tok_share:.1f}% | {et_share:.1f}% | {mult:.2f}× |\n"

    if sorted_projects:
        md += "\n### By Project\n\n| Project | Tokens | ET |\n|---------|-------:|---:|\n"
        for proj, data in sorted_projects:
            md += f"| {proj} | {data['tokens']:,} | {data['et']:,.0f} |\n"

    md += f"""
## Usage Log

| Date | Tool | Input Tokens | Output Tokens | ET | Notes |
|------|------|-------------:|--------------:|---:|-------|
| {today} | all | {totals['input_tokens']:,} | {totals['output_tokens']:,} | {totals['et']:,.0f} | Auto-sync from TokenTracker |

## Summary

- **Total Input Tokens:** {totals['input_tokens']:,}
- **Total Output Tokens:** {totals['output_tokens']:,}
- **Total Cached Input Tokens:** {totals['cached_input_tokens']:,}
- **Total Tokens:** {totals['total_tokens']:,}
- **Effective Tokens (ET):** {totals['et']:,.0f}
- **Sessions Tracked:** {totals['conversations']:,.0f}

## Methodology

Effective Tokens (ET) uses the GitHub token-efficiency weighting:

```
ET = m × (1.0 × I + 0.1 × C + 4.0 × O)
```

- `m` = model cost multiplier (Haiku 0.25×, Sonnet/GPT-4-class 1.0×, Opus/thinking 5.0×).
- `I` = newly-processed input tokens.
- `C` = cache-read tokens (weighted 0.1× because they are cheap).
- `O` = output tokens (weighted 4.0× because they dominate cost).

Exact USD cost requires mapping TokenTracker's tool-specific model aliases to
LiteLLM pricing IDs from `{PRICING_FILE}`.
"""

    OUT_FILE.write_text(md, encoding="utf-8")
    print(f"Wrote {OUT_FILE.resolve()} — {len(rows):,} buckets, {totals['total_tokens']:,} tokens, {totals['et']:,.0f} ET.")
    print(f"Pricing cache available: {bool(pricing)} ({len(pricing)} models)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
