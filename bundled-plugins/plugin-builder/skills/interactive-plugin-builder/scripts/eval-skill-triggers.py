#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import select
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="对已构建插件的 Skill 做触发评测（claude 无头模式）")
    parser.add_argument("plugin_dir", type=Path, help="含 .claude-plugin 或 .codex-plugin 的插件目录")
    parser.add_argument("--evals", type=Path, required=True, help="题库 JSON：{skill, positive: [], negative: []}")
    parser.add_argument("--runs", type=int, default=1)
    parser.add_argument("--timeout", type=int, default=180, help="单条查询超时秒数")
    parser.add_argument("--out", type=Path, default=None, help="缺省为 evidence/check/skill-trigger-eval/<skill>.json")
    parser.add_argument("--min-positive", type=float, default=None)
    parser.add_argument("--max-negative", type=float, default=None)
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def resolve_plugin(plugin_dir: Path) -> tuple[str, str] | None:
    for host, manifest in (("claude", ".claude-plugin"), ("codex", ".codex-plugin")):
        path = plugin_dir / manifest / "plugin.json"
        if path.is_file():
            try:
                name = json.loads(path.read_text(encoding="utf-8")).get("name")
            except Exception:
                name = None
            if not isinstance(name, str) or not name.strip():
                name = plugin_dir.name
            return host, name
    return None


def build_shadow(plugin_dir: Path, plugin_name: str) -> Path:
    shadow = Path(tempfile.mkdtemp(prefix="skill-eval-shadow-"))
    (shadow / ".claude-plugin").mkdir(parents=True)
    (shadow / ".claude-plugin" / "plugin.json").write_text(
        json.dumps({"name": plugin_name}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    skills_dir = plugin_dir / "skills"
    if skills_dir.is_dir():
        shutil.copytree(skills_dir, shadow / "skills")
    return shadow


def build_command(eval_dir: Path, query: str) -> list[str]:
    return [
        "claude",
        "--plugin-dir",
        str(eval_dir),
        "-p",
        query,
        "--output-format",
        "stream-json",
        "--verbose",
        "--max-turns",
        "3",
    ]


def run_query(eval_dir: Path, query: str, skill: str, timeout: int) -> dict:
    env = {k: v for k, v in os.environ.items() if k not in ("CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT")}
    started = time.monotonic()
    deadline = started + timeout
    proc = subprocess.Popen(
        build_command(eval_dir, query),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env=env,
    )
    triggered = False
    matched = ""
    timed_out = False
    markers = (f"/{skill}/SKILL.md", f'"{skill}"', f":{skill}", f"{skill})")
    try:
        assert proc.stdout is not None
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                timed_out = True
                break
            readable, _, _ = select.select([proc.stdout], [], [], min(remaining, 1.0))
            if not readable:
                if proc.poll() is not None:
                    break
                continue
            line = proc.stdout.readline()
            if not line:
                if proc.poll() is not None:
                    break
                continue
            if "tool_use" in line and any(marker in line for marker in markers):
                triggered = True
                matched = line.strip()[:200]
                break
    finally:
        stopped_early = proc.poll() is None
        if stopped_early:
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=10)
    cli_error = not triggered and not timed_out and not stopped_early and proc.returncode not in (0, None)
    stderr_tail = ""
    if proc.stderr is not None:
        if cli_error:
            try:
                stderr_tail = proc.stderr.read()[-300:].strip()
            except Exception:
                stderr_tail = ""
        try:
            proc.stderr.close()
        except Exception:
            pass
    if proc.stdout is not None:
        try:
            proc.stdout.close()
        except Exception:
            pass
    record = {
        "triggered": triggered,
        "matched": matched,
        "seconds": round(time.monotonic() - started, 1),
        "timedOut": timed_out,
        "cliError": cli_error,
        "exitCode": proc.returncode,
    }
    if cli_error and stderr_tail:
        record["stderrTail"] = stderr_tail
    return record


def main() -> int:
    args = parse_args()
    plugin_dir = args.plugin_dir.resolve()
    resolved = resolve_plugin(plugin_dir)
    if resolved is None:
        print(f"插件目录缺少 .claude-plugin 或 .codex-plugin manifest：{plugin_dir}", file=sys.stderr)
        return 2
    host, plugin_name = resolved
    try:
        spec = json.loads(args.evals.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"题库无法读取或解析：{args.evals}：{exc}", file=sys.stderr)
        return 2
    skill = spec.get("skill")
    positive = spec.get("positive", [])
    negative = spec.get("negative", [])
    if not isinstance(skill, str) or not skill.strip():
        print("题库缺少 skill 字段", file=sys.stderr)
        return 2
    if not positive or not negative:
        print("题库必须同时包含 positive 与 negative 查询", file=sys.stderr)
        return 2
    if args.dry_run:
        for query in list(positive) + list(negative):
            print(" ".join(build_command(plugin_dir, query)))
        if host == "codex":
            print("检测到 .codex-plugin：实跑时将自动构建 skills 影子副本（临时 .claude-plugin + skills/）执行评测。")
        return 0
    if not shutil.which("claude"):
        print("未找到 claude CLI：触发评测需要 claude 无头模式，当前宿主跳过并在报告注明评测未运行。", file=sys.stderr)
        return 3

    shadow: Path | None = None
    eval_dir = plugin_dir
    if host == "codex":
        shadow = build_shadow(plugin_dir, plugin_name)
        eval_dir = shadow
        print(f"检测到 .codex-plugin：使用 skills 影子副本评测（{shadow}）")

    cases = []
    try:
        for expect, queries in (("trigger", positive), ("skip", negative)):
            for query in queries:
                runs = []
                for _ in range(max(1, args.runs)):
                    result = run_query(eval_dir, query, skill, args.timeout)
                    runs.append(result)
                    if result["cliError"]:
                        flag = "CLI 失败"
                    elif result["timedOut"]:
                        flag = "超时"
                    elif result["triggered"]:
                        flag = "触发"
                    else:
                        flag = "未触发"
                    print(f"[{expect}] {query[:40]!r} → {flag}（{result['seconds']}s）")
                cases.append({"query": query, "expect": expect, "runs": runs})
    finally:
        if shadow is not None:
            shutil.rmtree(shadow, ignore_errors=True)

    cli_errors = [r for c in cases for r in c["runs"] if r["cliError"]]
    valid = [r for c in cases for r in c["runs"] if not r["cliError"]]

    def rate(expect: str, want_trigger: bool) -> float:
        sample = [r for c in cases if c["expect"] == expect for r in c["runs"] if not r["cliError"]]
        if not sample:
            return 0.0
        hits = sum(1 for r in sample if r["triggered"] is want_trigger)
        return round(hits / len(sample), 3)

    report = {
        "plugin": str(plugin_dir),
        "host": host,
        "skill": skill,
        "runsPerQuery": max(1, args.runs),
        "cases": cases,
        "positiveRate": rate("trigger", True),
        "negativeFalseRate": rate("skip", True),
        "cliErrorRuns": len(cli_errors),
    }
    gates_failed = []
    if args.min_positive is not None and report["positiveRate"] < args.min_positive:
        gates_failed.append(f"positiveRate {report['positiveRate']} < {args.min_positive}")
    if args.max_negative is not None and report["negativeFalseRate"] > args.max_negative:
        gates_failed.append(f"negativeFalseRate {report['negativeFalseRate']} > {args.max_negative}")
    report["gatesFailed"] = gates_failed
    out = args.out or Path("evidence/check/skill-trigger-eval") / f"{skill}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"正例触发率 {report['positiveRate']}，负例误触发率 {report['negativeFalseRate']}，报告：{out}")
    if cli_errors:
        sample = next((r.get("stderrTail", "") for r in cli_errors if r.get("stderrTail")), "")
        print(f"claude CLI 运行失败 {len(cli_errors)} 次（exitCode 非零），评测结果不可信：{sample}", file=sys.stderr)
        return 3
    if not valid:
        print("没有任何有效评测运行。", file=sys.stderr)
        return 3
    if gates_failed:
        for item in gates_failed:
            print(f"阈值未达标：{item}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
