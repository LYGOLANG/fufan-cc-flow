#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
import re
import shutil
import subprocess
import sys
from pathlib import Path


def run(command: list[str]) -> int:
    return subprocess.run(command, check=False).returncode


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("plugin_dir", type=Path, help="要安装的 Plugin 文件夹")
    parser.add_argument("--marketplace-root", type=Path, default=Path.home() / "claude-plugins")
    parser.add_argument("--marketplace-name", default="personal")
    args = parser.parse_args()

    source = args.plugin_dir.resolve()
    manifest_path = source / ".claude-plugin" / "plugin.json"
    has_manifest = manifest_path.is_file()
    if has_manifest:
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except Exception as exc:
            print(f"plugin.json 无效：{exc}", file=sys.stderr)
            return 2
        plugin_id = manifest.get("name")
        if not isinstance(plugin_id, str) or not plugin_id.strip():
            print("plugin.json.name 缺失，无法确定插件 ID", file=sys.stderr)
            return 2
    else:
        plugin_id = re.sub(r"[^a-z0-9]+", "-", source.name.lower()).strip("-")
        if not plugin_id:
            print(f"目录名无法推导插件 ID：{source}", file=sys.stderr)
            return 2
        print(f"未找到 plugin.json（宿主允许无 manifest），以目录名推导插件 ID：{plugin_id}")

    if not shutil.which("claude"):
        print("未找到 claude CLI，请先安装 Claude Code。", file=sys.stderr)
        return 1

    root = args.marketplace_root.resolve()
    dest = root / "plugins" / plugin_id
    print(f"→ 复制插件到 {dest}")
    (root / "plugins").mkdir(parents=True, exist_ok=True)
    (root / ".claude-plugin").mkdir(parents=True, exist_ok=True)
    if dest.exists():
        shutil.rmtree(dest)
    shutil.copytree(
        source,
        dest,
        ignore=shutil.ignore_patterns(".git", "dist", "__pycache__", "*.pyc", ".DS_Store"),
    )

    if has_manifest:
        bumped_path = dest / ".claude-plugin" / "plugin.json"
        bumped = json.loads(bumped_path.read_text(encoding="utf-8"))
        base_version = str(bumped.get("version", "0.1.0")).split("+")[0]
        bumped["version"] = f"{base_version}+local.{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}"
        bumped_path.write_text(json.dumps(bumped, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"→ 版本刷新：{bumped['version']}")

    print("→ 登记 marketplace 条目")
    mp_path = root / ".claude-plugin" / "marketplace.json"
    data = {"name": args.marketplace_name, "owner": {"name": args.marketplace_name}, "plugins": []}
    if mp_path.exists():
        try:
            data = json.loads(mp_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            print(f"既有 marketplace.json 无效，请先修复：{mp_path}：{exc}", file=sys.stderr)
            return 2
        if not isinstance(data, dict) or not isinstance(data.get("plugins", []), list):
            print(f"既有 marketplace.json 结构异常（需对象且 plugins 为数组）：{mp_path}", file=sys.stderr)
            return 2
    entries = data.setdefault("plugins", [])
    if not any(isinstance(e, dict) and e.get("name") == plugin_id for e in entries):
        entry = {
            "name": plugin_id,
            "source": f"./plugins/{plugin_id}",
            "category": "Productivity",
        }
        description = manifest.get("description") if has_manifest else None
        if isinstance(description, str) and description.strip():
            entry["description"] = description
        entries.append(entry)
    mp_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print("→ 校验 marketplace")
    if run(["claude", "plugin", "validate", str(root)]):
        return 1

    print("→ 注册并安装")
    if run(["claude", "plugin", "marketplace", "add", str(root)]):
        if run(["claude", "plugin", "marketplace", "update", args.marketplace_name]):
            return 1
    spec = f"{plugin_id}@{args.marketplace_name}"
    if run(["claude", "plugin", "install", spec]):
        if run(["claude", "plugin", "update", spec]):
            return 1

    print("")
    print(f"完成：{spec} 已安装。当前会话运行 /reload-plugins，或开新会话生效。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
