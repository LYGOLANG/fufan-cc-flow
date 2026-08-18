#!/usr/bin/env python3
from __future__ import annotations

import argparse
import re
from datetime import datetime, timezone
from pathlib import Path


def interactive_skill_dir() -> Path:
    return Path(__file__).resolve().parents[1]


def strip_frontmatter(text: str) -> str:
    lines = text.splitlines()
    if lines and lines[0] == "---":
        for index, line in enumerate(lines[1:], start=1):
            if line == "---":
                return "\n".join(lines[index + 1 :]).lstrip("\n") + "\n"
    return text


def replace_tokens(text: str, plugin_id: str, title: str, now: str) -> str:
    replacements = {
        "[plugin-id]": plugin_id,
        "[Plugin Name]": title,
        "[名称或暂定名]": title,
        "[YYYY-MM-DD]": now[:10],
        "[YYYY-MM-DD HH:mm]": now[:16].replace("T", " "),
        "[ISO-8601]": now,
        "[time]": now,
        "[target id]": "claude-code",
        'id: "replace-me"': f'id: "{plugin_id}"',
        'title: "Replace Me"': f'title: "{title}"',
        'directory: ".replace-me"': f'directory: ".{plugin_id}"',
        'codeRoot: "./replace-me"': f'codeRoot: "./{plugin_id}"',
        'stateDirectory: ".replace-me"': f'stateDirectory: ".{plugin_id}"',
    }
    for old, new in replacements.items():
        text = text.replace(old, new)
    return text


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("plugin_id", nargs="?", help="小写 kebab-case Plugin ID")
    parser.add_argument("--plugin-id", dest="plugin_id_flag", help="小写 kebab-case Plugin ID")
    parser.add_argument("--title", required=True, help="用户可见的 Plugin 名称")
    parser.add_argument("--project-dir", "--root", dest="root", type=Path, default=Path.cwd())
    parser.add_argument("--force", action="store_true", help="覆盖已经存在的初始化文件")
    args = parser.parse_args()

    plugin_id = args.plugin_id_flag or args.plugin_id
    if not plugin_id:
        parser.error("请提供 plugin_id 或 --plugin-id")
    if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", plugin_id):
        parser.error("plugin_id 必须是小写 kebab-case")
    if len(plugin_id) > 64:
        parser.error("plugin_id 不得超过 64 字符")

    root = args.root.resolve()
    root.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    skill = interactive_skill_dir()
    templates = {
        "Plugin-Spec-CHANGELOG.md": skill / "templates" / "spec-changelog-template.md",
        "Plugin-Project-State.md": skill / "templates" / "plugin-project-state-template.md",
        "plugin.yaml": skill / "templates" / "plugin-yaml-template.yaml",
    }

    results: list[tuple[str, str]] = []
    for filename, template_path in templates.items():
        if not template_path.is_file():
            raise SystemExit(f"缺少初始化模板：{template_path}")
        content = strip_frontmatter(template_path.read_text(encoding="utf-8"))
        content = replace_tokens(content, plugin_id, args.title, now)
        destination = root / filename
        existed = destination.exists()
        if existed and not args.force:
            status = "kept"
        else:
            destination.write_text(content, encoding="utf-8")
            status = "overwritten" if existed else "created"
        results.append((filename, status))

    for directory in ("contracts", "evidence", "dist", plugin_id):
        (root / directory).mkdir(parents=True, exist_ok=True)

    print(f"Initialized Plugin Builder project: {root}")
    for filename, status in results:
        print(f"- {status}: {filename}")
    print("Next: use plugin-spec-builder Skill")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
