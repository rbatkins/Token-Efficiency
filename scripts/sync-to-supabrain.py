#!/usr/bin/env python3
"""Sync TokenTracker usage data to a SupaBrain markdown page.

Reads ~/.tokentracker/tracker/queue.jsonl and project.queue.jsonl, computes
Effective Tokens (ET) using the GitHub token-efficiency formula, looks up
pricing via TokenTracker's curated overrides and LiteLLM cache, and writes a
SupaBrain-compatible markdown file.

Run: python scripts/sync-to-supabrain.py
Ingest: gbrain capture --file token-efficiency-supabrain.md --slug token-tracker
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

TOKENTRACKER_DIR = Path.home() / ".tokentracker" / "tracker"
QUEUE_FILE = TOKENTRACKER_DIR / "queue.jsonl"
PROJECT_QUEUE_FILE = TOKENTRACKER_DIR / "project.queue.jsonl"
PRICING_CACHE_FILE = Path.home() / ".tokentracker" / "cache" / "pricing.json"
CURATED_OVERRIDES_FILE = Path(__file__).parent.parent / "src" / "lib" / "pricing" / "curated-overrides.json"
LITELLM_URL = "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json"
OUT_FILE = Path("token-efficiency-supabrain.md")

SUFFIX_STRIP_PATTERNS = [
    re.compile(r"-high-thinking$"),
    re.compile(r"-medium-thinking$"),
    re.compile(r"-low-thinking$"),
    re.compile(r"-thinking$"),
    re.compile(r"-xhigh-fast$"),
    re.compile(r"-high-fast$"),
    re.compile(r"-medium-fast$"),
    re.compile(r"-low-fast$"),
    re.compile(r"-xhigh$"),
    re.compile(r"-high$"),
    re.compile(r"-medium$"),
    re.compile(r"-low$"),
    re.compile(r"-fast$"),
]

# Fork-specific pricing overrides for model aliases not covered by upstream
# TokenTracker curated overrides.
FORK_PRICING_OVERRIDES = {
    "alias": {
        "agent-review": "composer-1",
        "github-bugbot": "composer-1",
    },
    "fuzzy": [
        {"match": "grok-build", "ref": "grok-build"},
        {"match": "claude-sonnet-4-6", "ref": "claude-sonnet-4-6"},
        {"match": "claude-opus-4-6", "ref": "claude-opus-4-6"},
    ],
}


def normalize_antigravity_model(model: str) -> str:
    lower = re.sub(r"\([^)]*\)", " ", model)
    lower = re.sub(r"\b(thinking|xhigh|high|medium|low|fast)\b", " ", lower, flags=re.IGNORECASE)
    lower = lower.lower()
    lower = re.sub(r"[^a-z0-9.]+", "-", lower)
    lower = lower.strip("-")
    lower = re.sub(r"-{2,}", "-", lower)
    lower = strip_reasoning_suffix(lower)
    if lower.startswith("gemini-claude-") or lower.startswith("gemini-gpt-"):
        lower = lower[7:]
    if re.match(r"^gemini-3\.\d+-flash-lite", lower):
        return "gemini-2.5-flash-lite"
    if re.match(r"^gemini-3\.\d+-flash", lower):
        return "gemini-2.5-flash"
    if re.match(r"^gemini-3\.\d+-pro", lower):
        return "gemini-2.5-pro"
    m = re.match(r"^claude-(sonnet|opus|haiku)-4\.(\d+)", lower)
    if m:
        return f"claude-{m.group(1)}-4-{m.group(2)}"
    if lower.startswith("gpt-oss-120b"):
        return "antigravity-gpt-oss-120b"
    return lower


def normalize_claude_model(model: str) -> str:
    m = re.sub(r"\([^)]*\)", " ", model)
    m = re.sub(r"[^a-z0-9.]+", "-", m.lower())
    m = m.strip("-")
    m = re.sub(r"-{2,}", "-", m)
    if re.match(r"^claude-(sonnet|opus|haiku)-\d+\.\d+", m):
        return re.sub(r"^(claude-(?:sonnet|opus|haiku)-\d+)\.(\d+)", r"\1-\2", m)
    if re.match(r"^(sonnet|opus|haiku)-\d+[.-]\d+", m):
        m = re.sub(r"^(sonnet|opus|haiku)-", r"claude-\1-", m)
        m = re.sub(r"^(claude-(?:sonnet|opus|haiku)-\d+)\.(\d+)", r"\1-\2", m)
    return m


def normalize_zed_model(model: str) -> str:
    m = re.sub(r"\([^)]*\)", " ", model)
    m = re.sub(r"[^a-z0-9./]+", "-", m.lower())
    m = m.strip("-")
    m = re.sub(r"-{2,}", "-", m)
    if re.match(r"^claude-(sonnet|opus|haiku)-\d+\.\d+", m):
        m = re.sub(r"^(claude-(?:sonnet|opus|haiku)-\d+)\.(\d+)", r"\1-\2", m)
    return m


def normalize_cursor_model(model: str) -> str:
    """Cursor stores Claude model names as claude-4.6-sonnet-*; convert to claude-sonnet-4-6."""
    m = model.strip().lower()
    m = re.sub(r"\([^)]*\)", " ", m)
    m = re.sub(r"[^a-z0-9.]+", "-", m)
    m = m.strip("-")
    m = re.sub(r"-{2,}", "-", m)
    # claude-4.6-sonnet-* -> claude-sonnet-4-6-*
    m = re.sub(r"^claude-(\d+\.\d+)-(sonnet|opus|haiku)", r"claude-\2-\1", m)
    m = re.sub(r"^(\d+\.\d+)-(sonnet|opus|haiku)", r"claude-\2-\1", m)
    # claude-sonnet-4.6-* -> claude-sonnet-4-6-*
    m = re.sub(r"^(claude-(?:sonnet|opus|haiku)-\d+)\.(\d+)", r"\1-\2", m)
    return m


SOURCE_NORMALIZERS = {
    "antigravity": normalize_antigravity_model,
    "claude": normalize_claude_model,
    "cursor": normalize_cursor_model,
    "zed": normalize_zed_model,
}


def strip_reasoning_suffix(model: str) -> str:
    changed = True
    while changed:
        changed = False
        for pattern in SUFFIX_STRIP_PATTERNS:
            if pattern.search(model):
                model = pattern.sub("", model)
                changed = True
                break
    return model


def build_dot_restored_model(model: str) -> str:
    restored = re.sub(r"(\d+)-(\d+)", r"\1.\2", model.lower())
    return "" if restored == model.lower() else restored


def lookup_exact_case_insensitive(table: dict[str, Any], model: str) -> Optional[Any]:
    if not table or not model:
        return None
    if model in table:
        return table[model]
    lower = model.lower()
    for key, value in table.items():
        if key.lower() == lower:
            return value
    return None


def lookup_contained_exact_case_insensitive(table: dict[str, Any], model: str) -> Optional[Any]:
    if not table or not model:
        return None
    lower = model.lower()
    for key in sorted(table.keys(), key=len, reverse=True):
        if lower in key.lower():
            return table[key]
    return None


def lookup_pricing(model: str, curated: dict[str, Any], litellm: dict[str, Any], source: Optional[str] = None) -> dict[str, Any]:
    normalizer = SOURCE_NORMALIZERS.get(source.lower()) if source else None
    lookup_model = normalizer(model) if normalizer else model
    lower = lookup_model.lower()
    dot_form = build_dot_restored_model(lookup_model)

    exact = curated.get("exact", {})
    alias = {**curated.get("alias", {}), **FORK_PRICING_OVERRIDES.get("alias", {})}
    fuzzy = list(curated.get("fuzzy", [])) + list(FORK_PRICING_OVERRIDES.get("fuzzy", []))

    # 1. Curated exact
    if exact.get(lookup_model):
        return {"hit": True, "source": "curated:exact", "value": exact[lookup_model]}
    curated_dot_exact = lookup_exact_case_insensitive(exact, dot_form)
    if curated_dot_exact:
        return {"hit": True, "source": "curated:exact-dot", "value": curated_dot_exact}
    curated_dot_contained = lookup_contained_exact_case_insensitive(exact, dot_form)
    if curated_dot_contained:
        return {"hit": True, "source": "curated:exact-dot", "value": curated_dot_contained}

    # 2. LiteLLM exact
    if litellm.get(lookup_model):
        return {"hit": True, "source": "litellm:exact", "value": litellm[lookup_model]}
    litellm_dot_exact = lookup_exact_case_insensitive(litellm, dot_form)
    if litellm_dot_exact:
        return {"hit": True, "source": "litellm:exact-dot", "value": litellm_dot_exact}

    # 3. Curated alias
    if alias.get(lookup_model) and exact.get(alias[lookup_model]):
        return {"hit": True, "source": "curated:alias", "value": exact[alias[lookup_model]]}

    # 4. Curated fuzzy
    for item in fuzzy:
        match = item.get("match", "").lower()
        ref = item.get("ref")
        if not match or not ref or not exact.get(ref):
            continue
        if match in lower or (dot_form and match in dot_form):
            return {"hit": True, "source": "curated:fuzzy", "value": exact[ref]}

    # 5. LiteLLM suffix strip
    stripped = strip_reasoning_suffix(lookup_model)
    if stripped != lookup_model and litellm.get(stripped):
        return {"hit": True, "source": "litellm:strip", "value": litellm[stripped]}

    # 5b. LiteLLM provider-prefix strip
    suffix = "/" + lower
    best = None
    for key in litellm.keys():
        if len(key) > len(suffix) and key.lower().endswith(suffix):
            if best is None or key < best:
                best = key
    if best:
        return {"hit": True, "source": "litellm:prefix-strip", "value": litellm[best]}

    # 6. LiteLLM reverse substring
    for key in sorted(litellm.keys(), key=len, reverse=True):
        key_lower = key.lower()
        if key_lower in lower or (dot_form and key_lower in dot_form):
            return {"hit": True, "source": "litellm:fuzzy", "value": litellm[key]}

    return {"hit": False, "source": "miss", "value": {"input": 0, "output": 0, "cache_read": 0, "cache_write": 0}}


def convert_litellm_entry(entry: dict[str, Any]) -> Optional[dict[str, float]]:
    if not entry or not isinstance(entry, dict):
        return None
    out: dict[str, float] = {}
    if isinstance(entry.get("input_cost_per_token"), (int, float)):
        out["input"] = round(entry["input_cost_per_token"] * 1_000_000, 10)
    if isinstance(entry.get("output_cost_per_token"), (int, float)):
        out["output"] = round(entry["output_cost_per_token"] * 1_000_000, 10)
    if isinstance(entry.get("cache_read_input_token_cost"), (int, float)):
        out["cache_read"] = round(entry["cache_read_input_token_cost"] * 1_000_000, 10)
    if isinstance(entry.get("cache_creation_input_token_cost"), (int, float)):
        out["cache_write"] = round(entry["cache_creation_input_token_cost"] * 1_000_000, 10)
    return out if out else None


def build_litellm_per_million_map(raw_data: dict[str, Any]) -> dict[str, dict[str, float]]:
    out: dict[str, dict[str, float]] = {}
    for name, entry in raw_data.items():
        if name.startswith("_"):
            continue
        converted = convert_litellm_entry(entry)
        if converted:
            out[name] = converted
    return out


def load_curated_overrides() -> dict[str, Any]:
    if not CURATED_OVERRIDES_FILE.exists():
        return {}
    return json.loads(CURATED_OVERRIDES_FILE.read_text(encoding="utf-8"))


def load_pricing_cache(fetch_live: bool = False) -> dict[str, Any]:
    if fetch_live:
        print(f"Fetching live LiteLLM pricing from {LITELLM_URL} ...")
        with urllib.request.urlopen(LITELLM_URL, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    if not PRICING_CACHE_FILE.exists():
        print(f"Local pricing cache not found: {PRICING_CACHE_FILE}", file=sys.stderr)
        print("Run `tokentracker` once to populate it, or use --fetch-live.", file=sys.stderr)
        return {}
    return json.loads(PRICING_CACHE_FILE.read_text(encoding="utf-8"))


def model_multiplier(model: str) -> float:
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
    return multiplier * (
        1.0 * row.get("input_tokens", 0)
        + 0.1 * row.get("cached_input_tokens", 0)
        + 4.0 * row.get("output_tokens", 0)
    )


def compute_row_cost(row: dict[str, Any], pricing: dict[str, float]) -> float:
    source = row.get("source", "")
    reasoning_included = source in ("codex", "every-code")
    reasoning_cost = 0 if reasoning_included else (row.get("reasoning_output_tokens", 0) * pricing.get("output", 0))
    return (
        row.get("input_tokens", 0) * pricing.get("input", 0)
        + row.get("output_tokens", 0) * pricing.get("output", 0)
        + row.get("cached_input_tokens", 0) * pricing.get("cache_read", 0)
        + row.get("cache_creation_input_tokens", 0) * pricing.get("cache_write", 0)
        + reasoning_cost
    ) / 1_000_000


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


def format_usd(n: float) -> str:
    if n == 0:
        return "$0.00"
    if n < 0.01:
        return f"${n:.6f}"
    return f"${n:,.2f}"


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync TokenTracker usage to SupaBrain")
    parser.add_argument("--fetch-live", action="store_true", help="Fetch fresh LiteLLM pricing instead of using local cache")
    parser.add_argument("--output", type=Path, default=OUT_FILE, help="Output markdown file")
    args = parser.parse_args()

    if not QUEUE_FILE.exists():
        print(f"TokenTracker queue not found: {QUEUE_FILE}", file=sys.stderr)
        print("Run `npx tokentracker-cli` first to generate local usage data.", file=sys.stderr)
        return 1

    rows = load_jsonl(QUEUE_FILE)
    project_rows = load_jsonl(PROJECT_QUEUE_FILE)

    if not rows:
        print("No usage rows found.", file=sys.stderr)
        return 0

    curated = load_curated_overrides()
    pricing_raw = load_pricing_cache(fetch_live=args.fetch_live)
    litellm = build_litellm_per_million_map(pricing_raw)

    totals = {
        "input_tokens": sum(r.get("input_tokens", 0) for r in rows),
        "cached_input_tokens": sum(r.get("cached_input_tokens", 0) for r in rows),
        "cache_creation_input_tokens": sum(r.get("cache_creation_input_tokens", 0) for r in rows),
        "output_tokens": sum(r.get("output_tokens", 0) for r in rows),
        "reasoning_output_tokens": sum(r.get("reasoning_output_tokens", 0) for r in rows),
        "total_tokens": sum(r.get("total_tokens", 0) for r in rows),
        "billable_total_tokens": sum(r.get("billable_total_tokens", 0) for r in rows),
        "conversations": sum(r.get("conversation_count", 0) for r in rows),
        "et": 0.0,
        "cost": 0.0,
    }

    by_source: dict[str, dict[str, Any]] = defaultdict(lambda: {"tokens": 0, "et": 0.0, "cost": 0.0, "conversations": 0})
    by_model: dict[str, dict[str, Any]] = defaultdict(lambda: {"tokens": 0, "et": 0.0, "cost": 0.0, "conversations": 0, "buckets": 0, "pricing_source": "miss"})
    by_project: dict[str, dict[str, Any]] = defaultdict(lambda: {"tokens": 0, "et": 0.0, "cost": 0.0, "conversations": 0})

    pricing_misses: set[str] = set()

    for r in rows:
        model = r.get("model", "unknown")
        source = r.get("source", "unknown")
        mult = model_multiplier(model)
        et = effective_tokens(r, mult)

        pricing_result = lookup_pricing(model, curated, litellm, source)
        pricing = pricing_result["value"] if pricing_result["hit"] else {"input": 0, "output": 0, "cache_read": 0, "cache_write": 0}
        cost = compute_row_cost(r, pricing)

        if not pricing_result["hit"]:
            pricing_misses.add(f"{source}/{model}")

        totals["et"] += et
        totals["cost"] += cost

        by_source[source]["tokens"] += r.get("total_tokens", 0)
        by_source[source]["et"] += et
        by_source[source]["cost"] += cost
        by_source[source]["conversations"] += r.get("conversation_count", 0)

        by_model[model]["tokens"] += r.get("total_tokens", 0)
        by_model[model]["et"] += et
        by_model[model]["cost"] += cost
        by_model[model]["conversations"] += r.get("conversation_count", 0)
        by_model[model]["buckets"] += 1
        if pricing_result["hit"]:
            by_model[model]["pricing_source"] = pricing_result["source"]

    for r in project_rows:
        mult = model_multiplier(r.get("model", ""))
        et = effective_tokens(r, mult)
        model = r.get("model", "unknown")
        source = r.get("source", "unknown")
        pricing_result = lookup_pricing(model, curated, litellm, source)
        pricing = pricing_result["value"] if pricing_result["hit"] else {"input": 0, "output": 0, "cache_read": 0, "cache_write": 0}
        cost = compute_row_cost(r, pricing)
        key = r.get("project_key", "unknown")
        by_project[key]["tokens"] += r.get("total_tokens", 0)
        by_project[key]["et"] += et
        by_project[key]["cost"] += cost
        by_project[key]["conversations"] += r.get("conversation_count", 0)

    sorted_sources = sorted(by_source.items(), key=lambda x: x[1]["tokens"], reverse=True)
    sorted_models = sorted(by_model.items(), key=lambda x: x[1]["tokens"], reverse=True)
    sorted_projects = sorted(by_project.items(), key=lambda x: x[1]["tokens"], reverse=True)

    earliest = min(r.get("hour_start", "9999-12-31") for r in rows)
    latest = max(r.get("hour_start", "0000-01-01") for r in rows)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

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
| **Estimated cost** | {format_usd(totals['cost'])} |

### By Tool

| Tool | Tokens | ET | Cost | Share (Tokens) | Share (ET) |
|------|-------:|---:|-----:|---------------:|-----------:|
"""

    for src, data in sorted_sources:
        tok_share = data["tokens"] / totals["total_tokens"] * 100 if totals["total_tokens"] else 0
        et_share = data["et"] / totals["et"] * 100 if totals["et"] else 0
        md += f"| {src} | {data['tokens']:,} | {data['et']:,.0f} | {format_usd(data['cost'])} | {tok_share:.1f}% | {et_share:.1f}% |\n"

    md += "\n### By Model (top 15)\n\n| Model | Tokens | ET | Cost | Buckets | Tok Share | ET Share | Pricing Source |\n|-------|-------:|---:|-----:|--------:|----------:|---------:|---------------:|\n"
    for model, data in sorted_models[:15]:
        tok_share = data["tokens"] / totals["total_tokens"] * 100 if totals["total_tokens"] else 0
        et_share = data["et"] / totals["et"] * 100 if totals["et"] else 0
        md += f"| {model} | {data['tokens']:,} | {data['et']:,.0f} | {format_usd(data['cost'])} | {data['buckets']:,} | {tok_share:.1f}% | {et_share:.1f}% | {data['pricing_source']} |\n"

    if sorted_projects:
        md += "\n### By Project\n\n| Project | Tokens | ET | Cost |\n|---------|-------:|---:|-----:|\n"
        for proj, data in sorted_projects:
            md += f"| {proj} | {data['tokens']:,} | {data['et']:,.0f} | {format_usd(data['cost'])} |\n"

    if pricing_misses:
        md += "\n### Pricing Misses\n\nThe following source/model combinations could not be priced (shown as $0):\n\n"
        for miss in sorted(pricing_misses)[:20]:
            md += f"- `{miss}`\n"
        if len(pricing_misses) > 20:
            md += f"- ... and {len(pricing_misses) - 20} more\n"

    md += f"""
## Usage Log

| Date | Tool | Input Tokens | Output Tokens | ET | Cost | Notes |
|------|------|-------------:|--------------:|---:|-----:|-------|
| {today} | all | {totals['input_tokens']:,} | {totals['output_tokens']:,} | {totals['et']:,.0f} | {format_usd(totals['cost'])} | Auto-sync from TokenTracker |

## Summary

- **Total Input Tokens:** {totals['input_tokens']:,}
- **Total Output Tokens:** {totals['output_tokens']:,}
- **Total Cached Input Tokens:** {totals['cached_input_tokens']:,}
- **Total Tokens:** {totals['total_tokens']:,}
- **Effective Tokens (ET):** {totals['et']:,.0f}
- **Estimated Cost:** {format_usd(totals['cost'])}
- **Sessions Tracked:** {totals['conversations']:,.0f}

## Methodology

Effective Tokens (ET) uses the GitHub token-efficiency weighting:

```
ET = m × (1.0 × I + 0.1 × C + 4.0 × O)
```

Cost is computed from TokenTracker's curated overrides and LiteLLM cached pricing:

```
cost = (
    input_tokens × input_price_per_M +
    output_tokens × output_price_per_M +
    cached_input_tokens × cache_read_price_per_M +
    cache_creation_input_tokens × cache_write_price_per_M +
    reasoning_output_tokens × output_price_per_M
) / 1,000,000
```

Prices are in USD per million tokens. Models with no known price are shown as $0.
"""

    args.output.write_text(md, encoding="utf-8")
    print(f"Wrote {args.output.resolve()} — {len(rows):,} buckets, {totals['total_tokens']:,} tokens, {totals['et']:,.0f} ET, {format_usd(totals['cost'])}.")
    if pricing_misses:
        print(f"Pricing misses: {len(pricing_misses)} (see output file)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
