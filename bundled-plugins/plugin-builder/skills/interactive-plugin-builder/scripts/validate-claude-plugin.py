#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

try:
    import yaml
except ImportError as exc:
    raise SystemExit("PyYAML is required: python3 -m pip install --user pyyaml jsonschema") from exc

ALLOWED_TOP_LEVEL = {
    ".claude-plugin",
    ".gitignore",
    ".mcp.json",
    ".lsp.json",
    "agents",
    "bin",
    "commands",
    "contracts",
    "install.sh",
    "dist",
    "evidence",
    "node_modules",
    "packages",
    "hooks",
    "monitors",
    "output-styles",
    "scripts",
    "server",
    "skills",
    "tests",
    "themes",
    "ui",
    "README.md",
    "CHANGELOG.md",
    "LICENSE",
    "requirements.txt",
    "package.json",
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "settings.json",
    "MANIFEST.sha256",
    "PACKAGE-MANIFEST.json",
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def split_frontmatter(text: str) -> tuple[dict, str]:
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}, text
    try:
        end = next(i for i, line in enumerate(lines[1:], start=1) if line.strip() == "---")
    except StopIteration:
        return {}, text
    try:
        data = yaml.safe_load("\n".join(lines[1:end])) or {}
    except yaml.YAMLError as exc:
        return {"__frontmatter_error__": str(exc).splitlines()[0]}, "\n".join(lines[end + 1 :])
    return data if isinstance(data, dict) else {}, "\n".join(lines[end + 1 :])


def check_manifest(plugin_dir: Path, errors: list[str]) -> dict:
    path = plugin_dir / ".claude-plugin" / "plugin.json"
    if not path.exists():
        errors.append("缺少 .claude-plugin/plugin.json")
        return {}
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        errors.append(f"plugin.json 无效：{exc}")
        return {}
    name_value = manifest.get("name")
    if not isinstance(name_value, str) or not name_value.strip():
        errors.append("plugin.json.name 必须是非空字符串（宿主唯一必填字段）")
    for field in ("version", "description"):
        value = manifest.get(field)
        if not isinstance(value, str) or not value.strip():
            errors.append(f"plugin.json.{field} 必须是非空字符串（Harness 规范；宿主仅必填 name，version 缺省回退 git commit SHA）")
    if manifest.get("name") and not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", manifest["name"]):
        errors.append("plugin.json.name 必须是小写 kebab-case")
    return manifest


def check_optional_component_paths(plugin_dir: Path, manifest: dict, errors: list[str]) -> None:
    for field in ("skills", "commands", "agents"):
        values = manifest.get(field)
        if values is None:
            continue
        if isinstance(values, str):
            values = [values]
        if not isinstance(values, list):
            errors.append(f"plugin.json.{field} 必须是字符串或数组")
            continue
        for value in values:
            if not isinstance(value, str):
                errors.append(f"plugin.json.{field} 包含非字符串路径")
                continue
            if not (plugin_dir / value).resolve().exists():
                errors.append(f"plugin.json.{field} 路径不存在：{value}")


def check_skills(plugin_dir: Path, errors: list[str]) -> None:
    skills_dir = plugin_dir / "skills"
    if not skills_dir.exists():
        errors.append("缺少 skills/")
        return
    files = sorted(skills_dir.glob("*/SKILL.md"))
    if not files:
        errors.append("skills/ 下没有发现 */SKILL.md")
    for path in files:
        data, body = split_frontmatter(path.read_text(encoding="utf-8"))
        fm_error = data.get("__frontmatter_error__")
        if fm_error:
            errors.append(f"{path.relative_to(plugin_dir)}：frontmatter YAML 无效：{fm_error}")
            continue
        expected = path.parent.name
        if data.get("name") != expected:
            errors.append(f"{path.relative_to(plugin_dir)}：name 必须等于目录名 {expected}")
        if not isinstance(data.get("description"), str) or not data["description"].strip():
            errors.append(f"{path.relative_to(plugin_dir)}：缺少 description")
        for key in sorted(set(data) - {"name", "description", "license", "allowed-tools", "metadata", "compatibility"}):
            errors.append(f"{path.relative_to(plugin_dir)}：frontmatter 字段 {key} 不在宿主白名单内")
        if isinstance(data.get("name"), str):
            if len(data["name"]) > 64:
                errors.append(f"{path.relative_to(plugin_dir)}：name 不得超过 64 字符")
            if "anthropic" in data["name"] or "claude" in data["name"]:
                errors.append(f"{path.relative_to(plugin_dir)}：name 不得含保留词 anthropic / claude")
        if isinstance(data.get("description"), str):
            if len(data["description"]) > 1024:
                errors.append(f"{path.relative_to(plugin_dir)}：description 不得超过 1024 字符")
            if "<" in data["description"] or ">" in data["description"]:
                errors.append(f"{path.relative_to(plugin_dir)}：description 不得含尖括号")
        first = next((line.strip() for line in body.splitlines() if line.strip()), "")
        if first != "[任务]":
            errors.append(f"{path.relative_to(plugin_dir)}：正文第一节必须是 [任务]")


def check_agents(plugin_dir: Path, errors: list[str]) -> None:
    agents_dir = plugin_dir / "agents"
    if not agents_dir.exists():
        return
    for path in sorted(agents_dir.glob("*.md")):
        data, body = split_frontmatter(path.read_text(encoding="utf-8"))
        fm_error = data.get("__frontmatter_error__")
        if fm_error:
            errors.append(f"{path.relative_to(plugin_dir)}：frontmatter YAML 无效：{fm_error}")
            continue
        if not isinstance(data.get("name"), str) or not data["name"].strip():
            errors.append(f"{path.relative_to(plugin_dir)}：缺少 name")
        elif not (3 <= len(data["name"]) <= 50):
            errors.append(f"{path.relative_to(plugin_dir)}：name 长度须在 3-50 字符")
        if not isinstance(data.get("description"), str) or not data["description"].strip():
            errors.append(f"{path.relative_to(plugin_dir)}：缺少 description")
        model = data.get("model")
        if model is not None and model not in ("inherit", "sonnet", "opus", "haiku"):
            errors.append(f"{path.relative_to(plugin_dir)}：model 须为 inherit / sonnet / opus / haiku")
        first = next((line.strip() for line in body.splitlines() if line.strip()), "")
        if first != "[角色]":
            errors.append(f"{path.relative_to(plugin_dir)}：正文第一节必须是 [角色]")


def check_json_component(path: Path, label: str, errors: list[str]) -> dict | None:
    if not path.exists():
        return None
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        errors.append(f"{label} 无效：{exc}")
        return None
    if not isinstance(value, dict):
        errors.append(f"{label} 顶层必须是对象")
        return None
    return value


def check_mcp(plugin_dir: Path, errors: list[str]) -> None:
    data = check_json_component(plugin_dir / ".mcp.json", ".mcp.json", errors)
    if data is None:
        return
    servers = data.get("mcpServers")
    if not isinstance(servers, dict) or not servers:
        errors.append(".mcp.json.mcpServers 必须是非空映射")


def check_hooks(plugin_dir: Path, errors: list[str]) -> None:
    path = plugin_dir / "hooks" / "hooks.json"
    data = check_json_component(path, "hooks/hooks.json", errors)
    if data is not None and not isinstance(data.get("hooks"), dict):
        errors.append("hooks/hooks.json.hooks 必须是对象")


def check_package_manifest(plugin_dir: Path, errors: list[str], required: bool) -> None:
    path = plugin_dir / "PACKAGE-MANIFEST.json"
    if not path.exists():
        if required:
            errors.append("缺少 PACKAGE-MANIFEST.json")
        return
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        errors.append(f"PACKAGE-MANIFEST.json 无效：{exc}")
        return
    files = payload.get("files") if isinstance(payload, dict) else None
    if not isinstance(files, list):
        errors.append("PACKAGE-MANIFEST.json.files 必须是数组")
        return
    for item in files:
        if not isinstance(item, dict):
            errors.append("PACKAGE-MANIFEST.json.files 包含非对象")
            continue
        relative = item.get("path")
        expected = item.get("sha256")
        target = plugin_dir / str(relative)
        if not relative or not target.is_file():
            errors.append(f"PACKAGE-MANIFEST.json 引用文件不存在：{relative}")
            continue
        if sha256(target) != expected:
            errors.append(f"PACKAGE-MANIFEST.json hash 不一致：{relative}")


def check_checksum_manifest(plugin_dir: Path, errors: list[str], required: bool) -> None:
    path = plugin_dir / "MANIFEST.sha256"
    if not path.exists():
        if required:
            errors.append("缺少 MANIFEST.sha256")
        return

    entries: dict[str, str] = {}
    for lineno, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        line = raw.strip()
        if not line:
            continue
        match = re.fullmatch(r"([a-f0-9]{64})  (.+)", line)
        if not match:
            errors.append(f"MANIFEST.sha256:{lineno} 格式无效")
            continue
        expected, relative = match.groups()
        relative_path = Path(relative)
        if relative_path.is_absolute() or ".." in relative_path.parts:
            errors.append(f"MANIFEST.sha256:{lineno} 路径不安全：{relative}")
            continue
        if relative in entries:
            errors.append(f"MANIFEST.sha256 重复路径：{relative}")
            continue
        entries[relative] = expected

    expected_files = {
        item.relative_to(plugin_dir).as_posix()
        for item in plugin_dir.rglob("*")
        if item.is_file() and item.name != "MANIFEST.sha256"
    }
    declared_files = set(entries)
    missing = sorted(expected_files - declared_files)
    extra = sorted(declared_files - expected_files)
    if missing:
        errors.append(f"MANIFEST.sha256 缺少文件：{missing}")
    if extra:
        errors.append(f"MANIFEST.sha256 引用不存在文件：{extra}")

    for relative, expected in entries.items():
        target = plugin_dir / relative
        if target.is_file() and sha256(target) != expected:
            errors.append(f"MANIFEST.sha256 hash 不一致：{relative}")


def check_tree(plugin_dir: Path, errors: list[str]) -> None:
    for path in plugin_dir.iterdir():
        if path.name not in ALLOWED_TOP_LEVEL:
            errors.append(f"Plugin root 存在未声明条目：{path.name}")
    for name in ("CLAUDE.md", ".claude"):
        if (plugin_dir / name).exists():
            errors.append(f"安装型 Plugin root 不应包含 {name}")
    for path in plugin_dir.rglob("*"):
        if path.name in {".DS_Store", "__pycache__"} or path.suffix == ".pyc":
            errors.append(f"安装包包含临时文件：{path.relative_to(plugin_dir)}")
    hidden_components = plugin_dir / ".claude-plugin"
    for name in ("skills", "agents", "hooks", "commands"):
        if (hidden_components / name).exists():
            errors.append(f"{name}/ 必须位于 Plugin root，不能放进 .claude-plugin/")


def check_marketplace(marketplace_root: Path, plugin_name: str | None, errors: list[str]) -> None:
    path = marketplace_root / ".claude-plugin" / "marketplace.json"
    if not path.exists():
        errors.append(f"marketplace 根缺少 .claude-plugin/marketplace.json：{marketplace_root}")
        return
    try:
        marketplace = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        errors.append(f"marketplace.json 无效：{exc}")
        return
    name = marketplace.get("name")
    if not isinstance(name, str) or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", name or ""):
        errors.append("marketplace.json.name 必须是小写 kebab-case 非空字符串")
    owner = marketplace.get("owner")
    if not isinstance(owner, dict) or not isinstance(owner.get("name"), str) or not owner["name"].strip():
        errors.append("marketplace.json.owner.name 必须是非空字符串")
    plugins = marketplace.get("plugins")
    if not isinstance(plugins, list) or not plugins:
        errors.append("marketplace.json.plugins 必须是非空数组")
        return
    listed_names: list[str] = []
    for index, entry in enumerate(plugins):
        label = f"marketplace.json.plugins[{index}]"
        if not isinstance(entry, dict):
            errors.append(f"{label} 必须是对象")
            continue
        entry_name = entry.get("name")
        if not isinstance(entry_name, str) or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", entry_name or ""):
            errors.append(f"{label}.name 必须是小写 kebab-case 非空字符串")
        else:
            listed_names.append(entry_name)
        source = entry.get("source")
        if isinstance(source, str):
            if not source.startswith("./") or ".." in Path(source).parts:
                errors.append(f"{label}.source 相对路径必须以 ./ 开头且不含 ..")
            elif not (marketplace_root / source).resolve().is_dir():
                errors.append(f"{label}.source 路径不存在：{source}")
        elif isinstance(source, dict):
            if source.get("source") not in {"github", "url", "git-subdir", "npm"}:
                errors.append(f"{label}.source.source 必须是 github / url / git-subdir / npm 之一")
        else:
            errors.append(f"{label}.source 必须是相对路径字符串或来源对象")
    if plugin_name and plugin_name not in listed_names:
        errors.append(f"marketplace.json 未登记本插件：{plugin_name}")


def run_claude_validate(plugin_dir: Path, errors: list[str], required: bool = False) -> None:
    claude = shutil.which("claude")
    if not claude:
        if required:
            errors.append("请求了 --with-claude，但当前环境找不到 claude CLI")
        return
    result = subprocess.run(
        [claude, "plugin", "validate", str(plugin_dir), "--strict"],
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode:
        output = (result.stdout + "\n" + result.stderr).strip()
        errors.append(f"claude plugin validate 失败：{output}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("plugin_dir", type=Path)
    parser.add_argument("--with-claude", action="store_true")
    parser.add_argument("--require-package-manifest", action="store_true")
    parser.add_argument("--require-checksum-manifest", action="store_true")
    parser.add_argument(
        "--marketplace-root",
        type=Path,
        default=None,
        help="Personal Marketplace 根目录；校验 .claude-plugin/marketplace.json 并确认本插件已登记",
    )
    args = parser.parse_args()
    plugin_dir = args.plugin_dir.resolve()
    errors: list[str] = []

    if not plugin_dir.is_dir():
        print(f"Plugin directory not found: {plugin_dir}", file=sys.stderr)
        return 2

    manifest = check_manifest(plugin_dir, errors)
    check_optional_component_paths(plugin_dir, manifest, errors)
    check_skills(plugin_dir, errors)
    check_agents(plugin_dir, errors)
    check_mcp(plugin_dir, errors)
    check_hooks(plugin_dir, errors)
    check_tree(plugin_dir, errors)
    check_package_manifest(plugin_dir, errors, args.require_package_manifest)
    check_checksum_manifest(plugin_dir, errors, args.require_checksum_manifest)
    if args.marketplace_root is not None:
        plugin_name = manifest.get("name") if isinstance(manifest.get("name"), str) else None
        check_marketplace(args.marketplace_root.resolve(), plugin_name, errors)
    if args.with_claude or shutil.which("claude"):
        run_claude_validate(plugin_dir, errors, required=args.with_claude)

    if errors:
        print("Claude Code plugin validation failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    suffix = " + claude plugin validate --strict" if (args.with_claude or shutil.which("claude")) else ""
    print(f"Claude Code plugin validation passed{suffix}: {plugin_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
