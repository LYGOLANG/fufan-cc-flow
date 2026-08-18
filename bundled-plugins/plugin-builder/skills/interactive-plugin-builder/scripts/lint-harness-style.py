#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import os
import shlex
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

SKILL_FRONTMATTER_ORDER = ["name", "description"]
AGENT_FRONTMATTER_ORDER = [
    "name",
    "description",
    "skills",
    "model",
]
CLAUDE_SECTION_ORDER = [
    "角色",
    "任务",
    "第一性原理",
    "启动检查",
    "总体规则",
    "Skill 调用规则",
    "Sub-Agent 调度规则",
    "文件结构",
    "完成定义",
    "初始化",
]
SKILL_REQUIRED_SECTIONS = ["任务", "完成标准", "禁止"]
AGENT_REQUIRED_SECTIONS = ["角色", "任务", "输入", "输出", "完成标准", "禁止"]
ALLOWED_SUFFIXES = {".md", ".json", ".yaml", ".yml", ".py", ".mjs", ".ts", ".tsx", ".js", ".css", ".html", ".txt"}
IGNORED_PARTS = {"dist", "node_modules", ".git", "__pycache__", ".venv", "venv"}


@dataclass(frozen=True)
class Finding:
    path: Path
    line: int
    message: str

    def render(self, root: Path) -> str:
        try:
            rel = self.path.relative_to(root)
        except ValueError:
            rel = self.path
        return f"{rel}:{self.line}: {self.message}"


def find_root(start: Path) -> Path | None:
    current = start.resolve()
    if current.is_file():
        current = current.parent
    for candidate in [current, *current.parents]:
        if (candidate / ".claude-plugin" / "plugin.json").is_file() and (candidate / "skills" / "interactive-plugin-builder").is_dir():
            return candidate
    return None


def discover_root(start: Path) -> Path:
    return find_root(start) or start.resolve()


def hook_roots(payload: object) -> list[Path]:
    if not isinstance(payload, dict):
        return []
    tool_input = payload.get("tool_input")
    if not isinstance(tool_input, dict):
        return []
    raw_paths = [
        tool_input.get(key)
        for key in ("file_path", "path", "notebook_path")
        if isinstance(tool_input.get(key), str) and tool_input.get(key).strip()
    ]
    if not raw_paths:
        command = tool_input.get("command")
        if isinstance(command, str):
            raw_paths = [match.group(1).strip() for match in re.finditer(r"\*\*\* (?:Add|Update) File: (.+)", command)]
    roots: list[Path] = []
    for raw_path in raw_paths:
        candidate = Path(raw_path)
        if not candidate.is_absolute():
            project_dir = os.environ.get("CLAUDE_PROJECT_DIR")
            candidate = (Path(project_dir) / candidate) if project_dir else candidate
        found = find_root(candidate)
        if found is not None and found not in roots:
            roots.append(found)
    return roots


def detect_mode(root: Path) -> str:
    if (root / ".claude" / "CLAUDE.md").is_file():
        return "project"
    if (root / ".claude-plugin" / "plugin.json").is_file() and (root / "skills").is_dir():
        return "plugin"
    return "unknown"


def split_frontmatter(text: str) -> tuple[list[str], str, int]:
    lines = text.splitlines()
    if not lines or lines[0] != "---":
        return [], text, 1
    for index, line in enumerate(lines[1:], start=1):
        if line == "---":
            return lines[1:index], "\n".join(lines[index + 1 :]), index + 2
    return [], text, 1


def frontmatter_keys(lines: Iterable[str]) -> list[str]:
    keys: list[str] = []
    for line in lines:
        if not line or line[0].isspace() or line.startswith("-"):
            continue
        match = re.match(r"^([A-Za-z][A-Za-z0-9_-]*):", line)
        if match:
            keys.append(match.group(1))
    return keys


def frontmatter_scalars(lines: list[str]) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in lines:
        if not line or line[0].isspace() or line.startswith("-"):
            continue
        match = re.match(r"^([A-Za-z][A-Za-z0-9_-]*):(?:\s*(.*))?$", line)
        if match:
            values[match.group(1)] = (match.group(2) or "").strip().strip('"\'')
    return values


def validate_frontmatter(path: Path, expected_kind: str, findings: list[Finding]) -> tuple[dict[str, str], str, int]:
    text = path.read_text(encoding="utf-8")
    fm_lines, body, body_start = split_frontmatter(text)
    if not fm_lines:
        findings.append(Finding(path, 1, "缺少或未闭合 YAML frontmatter。"))
        return {}, body, body_start

    keys = frontmatter_keys(fm_lines)
    values = frontmatter_scalars(fm_lines)
    order = SKILL_FRONTMATTER_ORDER if expected_kind == "skill" else AGENT_FRONTMATTER_ORDER
    order_index = {key: index for index, key in enumerate(order)}

    if len(keys) != len(set(keys)):
        findings.append(Finding(path, 2, f"frontmatter 顶层字段重复：{keys}"))
    unknown = [key for key in keys if key not in order_index]
    if unknown:
        findings.append(Finding(path, 2, f"frontmatter 出现未纳入本 Harness 规范的字段：{unknown}"))
    known = [key for key in keys if key in order_index]
    if known != sorted(known, key=order_index.get):
        findings.append(Finding(path, 2, f"frontmatter 字段顺序不符合规范：{keys}"))
    if keys[:2] != ["name", "description"]:
        findings.append(Finding(path, 2, "frontmatter 前两项必须依次为 name、description。"))

    for required in ("name", "description"):
        if not values.get(required):
            findings.append(Finding(path, 2, f"frontmatter.{required} 必须是非空单行值。"))

    active_list_key: str | None = None
    for index, line in enumerate(fm_lines, start=2):
        if not line:
            continue
        if not line[0].isspace():
            match = re.match(r"^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$", line)
            active_list_key = match.group(1) if match and not match.group(2).strip() else None
            continue
        leading = len(line) - len(line.lstrip(" "))
        if leading % 4 != 0:
            findings.append(Finding(path, index, f"frontmatter 嵌套缩进必须是 4 的倍数，当前为 {leading}。"))
        if line.lstrip().startswith("-"):
            if leading != 4:
                findings.append(Finding(path, index, "frontmatter 列表项统一缩进 4 空格。"))
            if active_list_key is None:
                findings.append(Finding(path, index, "frontmatter 列表项前缺少对应字段。"))

    return values, body, body_start


def section_order(sections: list[str], expected: list[str], path: Path, body_start: int, findings: list[Finding]) -> None:
    positions = {section: sections.index(section) for section in expected if section in sections}
    present = [section for section in expected if section in positions]
    if present != sorted(present, key=lambda item: positions[item]):
        findings.append(Finding(path, body_start, f"章节顺序不符合规范：{present}"))


def validate_bracket_body(path: Path, body: str, body_start: int, kind: str, findings: list[Finding]) -> None:
    lines = body.splitlines()
    in_fence = False
    first_content: tuple[int, str] | None = None
    sections: list[str] = []

    for offset, line in enumerate(lines):
        lineno = body_start + offset
        stripped = line.strip()
        if not stripped:
            continue
        if first_content is None:
            first_content = (lineno, stripped)
        if line.lstrip().startswith("```"):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        if line.startswith("#"):
            findings.append(Finding(path, lineno, "主控、Skill 与 Subagent 正文禁止 Markdown # 标题。"))
        if "**" in line:
            findings.append(Finding(path, lineno, "主控、Skill 与 Subagent 正文不用 Markdown 粗体充当结构，改用方括号章节。"))
        leading = len(line) - len(line.lstrip(" "))
        if leading and leading % 4 != 0:
            findings.append(Finding(path, lineno, f"缩进必须是 4 的倍数，当前为 {leading}。"))
        if leading == 0:
            match = re.fullmatch(r"\[([^\]]+)\]", stripped)
            if not match:
                findings.append(Finding(path, lineno, "顶层正文只能使用 [章节]；普通正文必须缩进 4 空格。"))
            else:
                section = match.group(1)
                if section in sections:
                    findings.append(Finding(path, lineno, f"顶层章节重复：[{section}]"))
                sections.append(section)

    if in_fence:
        findings.append(Finding(path, max(body_start, body_start + len(lines) - 1), "代码围栏未闭合。"))

    expected_first = {"skill": "[任务]", "agent": "[角色]", "claude": "[角色]"}[kind]
    if first_content is None:
        findings.append(Finding(path, body_start, "正文为空。"))
    elif first_content[1] != expected_first:
        findings.append(Finding(path, first_content[0], f"正文第一节必须是 {expected_first}。"))

    if kind == "skill":
        for required in SKILL_REQUIRED_SECTIONS:
            if required not in sections:
                findings.append(Finding(path, body_start, f"SKILL.md 缺少 [{required}]。"))
        section_order(sections, ["任务", "完成标准", "禁止"], path, body_start, findings)
    elif kind == "agent":
        for required in AGENT_REQUIRED_SECTIONS:
            if required not in sections:
                findings.append(Finding(path, body_start, f"Subagent 缺少 [{required}]。"))
        section_order(sections, ["角色", "任务", "输入", "输出", "完成标准", "禁止"], path, body_start, findings)
    else:
        for required in CLAUDE_SECTION_ORDER:
            if required not in sections:
                findings.append(Finding(path, body_start, f"CLAUDE.md 缺少 [{required}]。"))
        section_order(sections, CLAUDE_SECTION_ORDER, path, body_start, findings)


def support_path_from_code(value: str) -> str | None:
    if not value.startswith(("references/", "templates/", "schemas/", "scripts/", "../interactive-plugin-builder/")):
        return None
    try:
        first = shlex.split(value)[0]
    except ValueError:
        first = value.split()[0]
    return first.rstrip(".,;:，。；：")


def validate_support_references(path: Path, body: str, body_start: int, findings: list[Finding]) -> None:
    for offset, line in enumerate(body.splitlines()):
        for value in re.findall(r"`([^`]+)`", line):
            relative = support_path_from_code(value)
            if relative is None:
                continue
            candidate = (path.parent / relative).resolve()
            if not candidate.exists():
                findings.append(Finding(path, body_start + offset, f"引用文件不存在：{relative}"))


def validate_common_text(path: Path, findings: list[Finding]) -> None:
    try:
        text = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return
    for lineno, line in enumerate(text.splitlines(), start=1):
        if "\t" in line:
            findings.append(Finding(path, lineno, "禁止 Tab，统一使用空格。"))
        if line.rstrip() != line:
            findings.append(Finding(path, lineno, "行尾存在多余空格。"))
    if "\r\n" in text:
        findings.append(Finding(path, 1, "统一使用 LF 换行。"))
    if text and not text.endswith("\n"):
        findings.append(Finding(path, max(1, len(text.splitlines())), "文件末尾必须有换行。"))


def collect_scoped_files(root: Path, mode: str) -> list[Path]:
    candidates: list[Path] = []
    for name in ("README.md", "CHANGELOG.md", "requirements.txt"):
        path = root / name
        if path.is_file():
            candidates.append(path)
    roots = [root / ".claude"] if mode == "project" else [root / ".claude-plugin", root / "skills", root / "agents", root / "hooks"]
    for base in roots:
        if not base.exists():
            continue
        candidates.extend(
            path
            for path in base.rglob("*")
            if path.is_file()
            and path.suffix.lower() in ALLOWED_SUFFIXES
            and not any(part in IGNORED_PARTS for part in path.parts)
        )
    return sorted(set(candidates))


def validate_plugin_manifest(root: Path, findings: list[Finding]) -> None:
    path = root / ".claude-plugin" / "plugin.json"
    if not path.is_file():
        findings.append(Finding(path, 1, "Plugin 模式缺少 .claude-plugin/plugin.json。"))
        return
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        findings.append(Finding(path, 1, f"plugin.json 无效：{exc}"))
        return
    name = data.get("name")
    if not isinstance(name, str) or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", name):
        findings.append(Finding(path, 1, "plugin.json.name 必须是小写 kebab-case。"))
    if not (root / "skills").is_dir():
        findings.append(Finding(root / "skills", 1, "Plugin root 缺少 skills/。"))
    if (root / ".claude-plugin" / "skills").exists() or (root / ".claude-plugin" / "agents").exists():
        findings.append(Finding(root / ".claude-plugin", 1, "skills/ 与 agents/ 必须位于 Plugin root，不能放进 .claude-plugin/。"))
    if (root / "CLAUDE.md").exists():
        findings.append(Finding(root / "CLAUDE.md", 1, "Plugin root 的 CLAUDE.md 不会作为项目上下文加载；编排应放入 Skill。"))
    router = root / "skills" / "interactive-plugin-builder" / "SKILL.md"
    if router.is_file() and "███████╗███████╗██╗" not in router.read_text(encoding="utf-8"):
        findings.append(Finding(router, 1, "总路由 Skill 必须保留 FEICAI ASCII 艺术品牌区块。"))


def run(root: Path) -> tuple[str, list[Finding]]:
    findings: list[Finding] = []
    mode = detect_mode(root)
    if mode == "unknown":
        findings.append(Finding(root, 1, "无法识别 Harness：需要项目级 .claude/CLAUDE.md 或 Plugin 级 .claude-plugin/plugin.json。"))
        return mode, findings

    for path in collect_scoped_files(root, mode):
        validate_common_text(path, findings)

    if mode == "project":
        claude_file = root / ".claude" / "CLAUDE.md"
        validate_bracket_body(claude_file, claude_file.read_text(encoding="utf-8"), 1, "claude", findings)
        skills_dir = root / ".claude" / "skills"
        agents_dir = root / ".claude" / "agents"
    else:
        validate_plugin_manifest(root, findings)
        skills_dir = root / "skills"
        agents_dir = root / "agents"

    skill_files = sorted(skills_dir.glob("*/SKILL.md"))
    if not skill_files:
        findings.append(Finding(skills_dir, 1, "没有发现 */SKILL.md。"))
    for path in skill_files:
        data, body, body_start = validate_frontmatter(path, "skill", findings)
        if data.get("name") and data["name"] != path.parent.name:
            findings.append(Finding(path, 2, f"Skill name 必须与目录名一致：{path.parent.name}"))
        validate_bracket_body(path, body, body_start, "skill", findings)
        validate_support_references(path, body, body_start, findings)

    for path in sorted(agents_dir.glob("*.md")) if agents_dir.exists() else []:
        data, body, body_start = validate_frontmatter(path, "agent", findings)
        name = data.get("name", "")
        if name and not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", name):
            findings.append(Finding(path, 2, "Agent name 必须是小写 kebab-case。"))
        if name and path.stem != name:
            findings.append(Finding(path, 2, f"Agent 文件名必须与 name 一致：{name}.md"))
        validate_bracket_body(path, body, body_start, "agent", findings)
        validate_support_references(path, body, body_start, findings)

    return mode, findings


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path)
    parser.add_argument("--hook", action="store_true", help="Claude Code PostToolUse hook mode。")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    hook_payload: object = {}
    if args.hook:
        raw = sys.stdin.read()
        try:
            hook_payload = json.loads(raw) if raw.strip() else {}
        except json.JSONDecodeError:
            hook_payload = {}

    default_root = discover_root(Path(__file__).resolve())
    if args.hook and args.root is None:
        roots = hook_roots(hook_payload)
        if not roots:
            return 0
        root = roots[0].resolve()
        findings = []
        mode = "plugin"
        for candidate in roots:
            mode, candidate_findings = run(candidate.resolve())
            findings.extend(candidate_findings)
    else:
        root = (args.root or default_root).resolve()
        mode, findings = run(root)

    if args.hook:
        if findings:
            rendered = "\n".join(f"- {item.render(root)}" for item in findings[:40])
            if len(findings) > 40:
                rendered += f"\n- 其余 {len(findings) - 40} 项请运行完整 Linter 查看。"
            print(json.dumps({"decision": "block", "reason": f"Harness 写作规范检查失败，请修复后继续：\n{rendered}"}, ensure_ascii=False))
        return 0

    if args.json:
        print(
            json.dumps(
                {
                    "ok": not findings,
                    "mode": mode,
                    "root": str(root),
                    "findings": [
                        {"path": str(item.path), "line": item.line, "message": item.message}
                        for item in findings
                    ],
                },
                ensure_ascii=False,
                indent=2,
            )
        )
    elif findings:
        print("Harness style check failed:", file=sys.stderr)
        for finding in findings:
            print(f"- {finding.render(root)}", file=sys.stderr)
    else:
        print(f"Harness style check passed ({mode}): {root}")

    return 1 if findings else 0


if __name__ == "__main__":
    raise SystemExit(main())
