#!/usr/bin/env python3
"""Collect code-quality metrics and combine them with TokenTracker usage data.

Reads ~/.tokentracker/tracker/project.queue.jsonl and config/code-quality.json,
runs configured test/lint/typecheck commands, counts commits and closed issues,
computes a weighted quality score, and writes quality/ET and quality/$ tables.

Run: python scripts/collect-code-quality.py
Ingest: gbrain capture --file token-efficiency-quality.md --slug token-tracker-quality
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

TOKENTRACKER_DIR = Path.home() / ".tokentracker" / "tracker"
PROJECT_QUEUE_FILE = TOKENTRACKER_DIR / "project.queue.jsonl"
PRICING_CACHE_FILE = Path.home() / ".tokentracker" / "cache" / "pricing.json"
CURATED_OVERRIDES_FILE = Path(__file__).parent.parent / "src" / "lib" / "pricing" / "curated-overrides.json"
QUALITY_CONFIG_FILE = Path(__file__).parent.parent / "config" / "code-quality.json"
OUT_FILE = Path("token-efficiency-quality.md")

# Re-use pricing helpers from sync-to-supabrain.py by loading it as a module.
# The file name contains a hyphen so a normal import will not work.
def _load_sync_module() -> Any:
    import importlib.util
    sync_path = Path(__file__).parent / "sync-to-supabrain.py"
    spec = importlib.util.spec_from_file_location("sync_to_supabrain", sync_path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Could not load sync-to-supabrain.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_sync = _load_sync_module()
build_litellm_per_million_map = _sync.build_litellm_per_million_map
compute_row_cost = _sync.compute_row_cost
effective_tokens = _sync.effective_tokens
load_curated_overrides = _sync.load_curated_overrides
load_jsonl = _sync.load_jsonl
load_pricing_cache = _sync.load_pricing_cache
lookup_pricing = _sync.lookup_pricing
model_multiplier = _sync.model_multiplier


def load_quality_config() -> dict[str, Any]:
    if not QUALITY_CONFIG_FILE.exists():
        return {"projects": {}}
    return json.loads(QUALITY_CONFIG_FILE.read_text(encoding="utf-8"))


def run_command(cmd: str, cwd: Optional[str], timeout: int = 300) -> dict[str, Any]:
    try:
        result = subprocess.run(
            cmd,
            shell=True,
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        return {
            "cmd": cmd,
            "cwd": cwd,
            "returncode": result.returncode,
            "stdout": result.stdout,
            "stderr": result.stderr,
        }
    except subprocess.TimeoutExpired:
        return {"cmd": cmd, "cwd": cwd, "returncode": -1, "stdout": "", "stderr": "timeout"}
    except Exception as e:
        return {"cmd": cmd, "cwd": cwd, "returncode": -1, "stdout": "", "stderr": str(e)}


def command_passed(run: dict[str, Any], cfg: dict[str, Any]) -> bool:
    if run["returncode"] != 0:
        return False
    output = (run.get("stdout", "") + "\n" + run.get("stderr", "")).lower()
    fail_regex = cfg.get("fail_regex")
    if fail_regex and re.search(fail_regex, output, re.IGNORECASE):
        return False
    pass_regex = cfg.get("pass_regex")
    if pass_regex and re.search(pass_regex, output, re.IGNORECASE):
        return True
    # No explicit pass marker: trust exit code.
    return run["returncode"] == 0


def count_commits(repo_path: str, since: str, until: str) -> int:
    try:
        result = subprocess.run(
            ["git", "log", f"--since={since}", f"--until={until}", "--oneline"],
            cwd=repo_path,
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode != 0:
            return 0
        lines = [line for line in result.stdout.splitlines() if line.strip()]
        return len(lines)
    except Exception:
        return 0


def count_closed_issues(repo: str, since: str, until: str) -> int:
    try:
        # GitHub search uses closed:>YYYY-MM-DD for closed-after.
        result = subprocess.run(
            [
                "gh", "issue", "list",
                "--repo", repo,
                "--state", "closed",
                "--search", f"closed:>{since} closed:<{until}",
                "--limit", "1000",
                "--json", "number",
            ],
            capture_output=True,
            text=True,
            timeout=60,
        )
        if result.returncode != 0:
            return 0
        data = json.loads(result.stdout or "[]")
        return len(data)
    except Exception:
        return 0


def collect_project_metrics(
    project_key: str,
    cfg: dict[str, Any],
    since: str,
    until: str,
) -> dict[str, Any]:
    repo_path = cfg.get("path", "")
    github_repo = cfg.get("github_repo", "")
    commands_cfg = cfg.get("commands", {})
    weights = cfg.get("weights", {})

    command_results: dict[str, Any] = {}
    for name, cmd_cfg in commands_cfg.items():
        run = run_command(cmd_cfg["cmd"], cmd_cfg.get("cwd"), timeout=cmd_cfg.get("timeout", 300))
        passed = command_passed(run, cmd_cfg)
        command_results[name] = {
            "passed": passed,
            "returncode": run["returncode"],
            "stderr_snippet": run.get("stderr", "")[:200],
        }

    commits = count_commits(repo_path, since, until) if repo_path and Path(repo_path).exists() else 0
    closed_issues = count_closed_issues(github_repo, since, until) if github_repo else 0

    # Normalize each component to 0..1.
    test_pass_rate = 1.0 if command_results.get("test", {}).get("passed") else 0.0
    lint_pass_rate = 1.0 if command_results.get("lint", {}).get("passed") else 0.0
    typecheck_pass_rate = 1.0 if command_results.get("typecheck", {}).get("passed") else 0.0

    # Bug fix rate and commit rate are sigmoid-ish capped scores.
    bug_fix_rate = min(1.0, closed_issues / 10.0) if closed_issues else 0.0
    commit_rate = min(1.0, commits / 50.0) if commits else 0.0

    quality_score = (
        test_pass_rate * weights.get("test_pass_rate", 0.30)
        + lint_pass_rate * weights.get("lint_pass_rate", 0.20)
        + typecheck_pass_rate * weights.get("typecheck_pass_rate", 0.20)
        + bug_fix_rate * weights.get("bug_fix_rate", 0.20)
        + commit_rate * weights.get("commit_rate", 0.10)
    ) * 10

    return {
        "command_results": command_results,
        "commits": commits,
        "closed_issues": closed_issues,
        "test_pass_rate": test_pass_rate,
        "lint_pass_rate": lint_pass_rate,
        "typecheck_pass_rate": typecheck_pass_rate,
        "bug_fix_rate": bug_fix_rate,
        "commit_rate": commit_rate,
        "quality_score": quality_score,
    }


def aggregate_project_usage(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    curated = load_curated_overrides()
    pricing_raw = load_pricing_cache()
    litellm = build_litellm_per_million_map(pricing_raw)

    by_project: dict[str, dict[str, Any]] = defaultdict(
        lambda: {"tokens": 0, "et": 0.0, "cost": 0.0, "conversations": 0, "buckets": 0}
    )

    for r in rows:
        model = r.get("model", "unknown")
        source = r.get("source", "unknown")
        mult = model_multiplier(model)
        et = effective_tokens(r, mult)
        pricing_result = lookup_pricing(model, curated, litellm, source)
        pricing = pricing_result["value"] if pricing_result["hit"] else {"input": 0, "output": 0, "cache_read": 0, "cache_write": 0}
        cost = compute_row_cost(r, pricing)
        key = r.get("project_key", "unknown")
        by_project[key]["tokens"] += r.get("total_tokens", 0)
        by_project[key]["et"] += et
        by_project[key]["cost"] += cost
        by_project[key]["conversations"] += r.get("conversation_count", 0)
        by_project[key]["buckets"] += 1

    return dict(by_project)


def format_usd(n: float) -> str:
    if n == 0:
        return "$0.00"
    if n < 0.01:
        return f"${n:.6f}"
    return f"${n:,.2f}"


def main() -> int:
    parser = argparse.ArgumentParser(description="Collect code-quality metrics for Token-Efficiency")
    parser.add_argument("--output", type=Path, default=OUT_FILE, help="Output markdown file")
    args = parser.parse_args()

    if not PROJECT_QUEUE_FILE.exists():
        print(f"Project queue not found: {PROJECT_QUEUE_FILE}", file=sys.stderr)
        return 1

    config = load_quality_config()
    project_rows = load_jsonl(PROJECT_QUEUE_FILE)
    if not project_rows:
        print("No project usage rows found.", file=sys.stderr)
        return 0

    since = min(r.get("hour_start", "9999-12-31") for r in project_rows)[:10]
    until = max(r.get("hour_start", "0000-01-01") for r in project_rows)[:10]
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    usage = aggregate_project_usage(project_rows)

    md = f"""---
type: tracker
tags: [tokens, usage, quality, efficiency, roi]
license: MIT
---

# Code Quality / Token Efficiency Snapshot

Auto-generated from `config/code-quality.json`, local git logs, GitHub issues, and
TokenTracker `project.queue.jsonl`.

## Snapshot

| Metric | Value |
|--------|-------|
| **Generated** | {today} |
| **Tracking period** | {since} → {until} |
| **Projects tracked** | {len(config.get('projects', {}))} |

## Projects

| Project | Tokens | ET | Cost | Quality Score | Quality/ET | Quality/$ | Commits | Closed Issues |
|---------|-------:|---:|-----:|--------------:|-----------:|----------:|--------:|--------------:|
"""

    for project_key, cfg in config.get("projects", {}).items():
        metrics = collect_project_metrics(project_key, cfg, since, until)
        u = usage.get(project_key, {"tokens": 0, "et": 0.0, "cost": 0.0})
        quality_score = metrics["quality_score"]
        quality_per_et = quality_score / u["et"] * 1_000_000 if u["et"] else 0.0
        quality_per_dollar = quality_score / u["cost"] if u["cost"] else 0.0

        md += (
            f"| {project_key} | {u['tokens']:,} | {u['et']:,.0f} | {format_usd(u['cost'])} | "
            f"{quality_score:.2f} | {quality_per_et:.4f} | {quality_per_dollar:.4f} | "
            f"{metrics['commits']} | {metrics['closed_issues']} |\n"
        )

    md += "\n## Quality Components\n\n"
    md += "| Project | Test | Lint | Typecheck | Bug Fix Rate | Commit Rate |\n"
    md += "|---------|------|------|-----------|-------------:|------------:|\n"

    for project_key, cfg in config.get("projects", {}).items():
        metrics = collect_project_metrics(project_key, cfg, since, until)
        test_status = "✅ pass" if metrics["test_pass_rate"] else "❌ fail"
        lint_status = "✅ pass" if metrics["lint_pass_rate"] else "❌ fail"
        type_status = "✅ pass" if metrics["typecheck_pass_rate"] else "❌ fail"
        md += (
            f"| {project_key} | {test_status} | {lint_status} | {type_status} | "
            f"{metrics['bug_fix_rate']:.2f} | {metrics['commit_rate']:.2f} |\n"
        )

    # Collect warnings for the notes section.
    warnings: list[str] = []
    for project_key in config.get("projects", {}).keys():
        u = usage.get(project_key, {"cost": 0.0})
        if u["cost"] == 0.0:
            warnings.append(
                f"- `{project_key}` shows **$0.00 cost**. This usually means the project "
                "queue rows have an unresolvable model/source combination; check pricing "
                "misses in `token-efficiency-supabrain.md`."
            )

    if warnings:
        md += "\n## Warnings\n\n"
        for w in warnings:
            md += w + "\n"
        md += "\n"

    md += f"""## Methodology

Quality score (0–10) is a weighted composite:

```
quality_score = (
  test_pass_rate   × 0.30 +
  lint_pass_rate   × 0.20 +
  typecheck_pass_rate × 0.20 +
  bug_fix_rate     × 0.20 +
  commit_rate      × 0.10
) × 10
```

- `bug_fix_rate` = `min(1, closed_issues / 10)`
- `commit_rate` = `min(1, commits / 50)`
- Quality/ET = `quality_score / ET` (per million ET)
- Quality/$ = `quality_score / estimated_cost`

## Commands Run

"""
    for project_key, cfg in config.get("projects", {}).items():
        md += f"### {project_key}\n\n"
        for name, cmd_cfg in cfg.get("commands", {}).items():
            md += f"- **{name}:** `{cmd_cfg['cmd']}` (cwd: `{cmd_cfg.get('cwd', cfg.get('path', ''))}`)\n"
        md += "\n"

    args.output.write_text(md, encoding="utf-8")
    print(f"Wrote {args.output.resolve()} — tracked {len(config.get('projects', {}))} project(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
