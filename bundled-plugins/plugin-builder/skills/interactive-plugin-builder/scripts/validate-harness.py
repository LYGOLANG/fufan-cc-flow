#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


def discover_source_root(script: Path) -> Path:
    for candidate in script.resolve().parents:
        if (candidate / ".claude-plugin" / "plugin.json").is_file():
            return candidate
    raise SystemExit("无法找到包含 .claude-plugin/plugin.json 的 Harness 根。")


def run(command: list[str], *, cwd: Path | None = None) -> int:
    result = subprocess.run(command, cwd=cwd, check=False)
    return result.returncode


def compile_python(path: Path) -> None:
    compile(path.read_text(encoding="utf-8"), str(path), "exec")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path)
    args = parser.parse_args()

    script = Path(__file__).resolve()
    root = (args.root or discover_source_root(script)).resolve()
    skill = root / "skills" / "interactive-plugin-builder"
    scripts = skill / "scripts"
    linter = scripts / "lint-harness-style.py"
    validator = scripts / "validate-plugin-project.py"
    initializer = scripts / "init-plugin-project.py"
    scaffolder = scripts / "scaffold-plugin.py"
    plugin_validator = scripts / "validate-claude-plugin.py"

    required_paths = [
        root / ".claude-plugin" / "plugin.json",
        root / "hooks" / "hooks.json",
        root / "agents" / "plugin-reviewer.md",
        skill / "schemas" / "plugin.schema.json",
        skill / "schemas" / "project-state.schema.json",
        skill / "schemas" / "evidence.schema.json",
        skill / "templates" / "plugin-yaml-template.yaml",
        skill / "templates" / "claude-marketplace.template.json",
        skill / "templates" / "codex-plugin-manifest.template.json",
        skill / "templates" / "codex-marketplace.template.json",
        skill / "assets" / "ui-kits" / "kits.md",
        *[
            skill / "assets" / "ui-kits" / kit / name
            for kit in ("neural-pro", "ink-on-paper")
            for name in ("tokens.css", "components.css", "components.js", "demo.html", "kit.md")
        ],
        skill.parent / "plugin-installer" / "SKILL.md",
        scripts / "install-plugin.py",
        scripts / "eval-skill-triggers.py",
        scripts / "audit-ui.mjs",
        skill.parent / "plugin-checker" / "references" / "skill-eval.md",
        root / "install.sh",
        linter,
        validator,
        initializer,
        scaffolder,
        plugin_validator,
    ]
    missing = [path for path in required_paths if not path.is_file()]
    if missing:
        for path in missing:
            print(f"missing required Harness file: {path}", file=sys.stderr)
        return 1

    stale_paths = [
        root / "CLAUDE.md",
        root / "settings.json",
        root / "skills" / "plugin-checker" / "scripts" / "validate_plugin_project.py",
        root / "skills" / "plugin-checker" / "references" / "plugin-checklist.md",
        root / "skills" / "interactive-plugin-builder" / "references" / "writing-standard.md",
        root / "skills" / "interactive-plugin-builder" / "templates" / "claude-plugin-manifest.template.json",
        root / "skills" / "interactive-plugin-builder" / "templates" / "plugin-interview-notes-template.md",
        root / "skills" / "interactive-plugin-builder" / "assets" / "ui-kit" / "tokens.css",
        root / "skills" / "interactive-plugin-builder" / "references" / "source-notes.md",
    ]
    for path in stale_paths:
        if path.exists():
            print(f"stale duplicate must be removed: {path}", file=sys.stderr)
            return 1

    if run([sys.executable, str(linter), "--root", str(root)]):
        return 1

    for path in root.rglob("*.json"):
        if any(part in {"dist", ".git", "__pycache__"} for part in path.parts):
            continue
        try:
            json.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:
            print(f"invalid JSON {path}: {exc}", file=sys.stderr)
            return 1

    for path in root.rglob("*.py"):
        if any(part in {"dist", ".git", "__pycache__"} for part in path.parts):
            continue
        try:
            compile_python(path)
        except Exception as exc:
            print(f"invalid Python {path}: {exc}", file=sys.stderr)
            return 1

    try:
        import yaml
        import jsonschema
    except ImportError:
        print("Install PyYAML and jsonschema before running full Harness validation.", file=sys.stderr)
        return 1

    with tempfile.TemporaryDirectory(prefix="plugin-builder-self-test-") as temporary:
        fixture = Path(temporary) / "fixture"
        if run([sys.executable, str(initializer), "fixture-plugin", "--title", "Fixture Plugin", "--root", str(fixture)]):
            return 1
        if run([sys.executable, str(validator), "--root", str(fixture), "--soft", "--draft"]):
            return 1
        if run([sys.executable, str(validator), "--root", str(fixture), "--ir-only", "--draft"]):
            return 1

        fixture_ir_path = fixture / "plugin.yaml"
        fixture_ir = yaml.safe_load(fixture_ir_path.read_text(encoding="utf-8"))
        fixture_ir["plugin"]["description"] = "A fixture interactive plugin used to validate the deterministic scaffold."
        fixture_ir["product"]["primaryUser"] = "Harness maintainer"
        fixture_ir["product"]["coreOutcome"] = "Prove the generated Claude Code plugin baseline."
        fixture_ir["product"]["guiNecessity"] = "The fixture must exercise a user-operated Browser UI and Agent request round-trip."
        fixture_ir["mcp"]["renderTool"] = "open_fixture_plugin"
        fixture_ir["mcp"]["appOnlyTools"] = ["save_fixture_state"]
        fixture_ir["mcp"]["agentTools"] = ["get_fixture_request", "apply_fixture_result"]
        fixture_ir["acceptance"]["required"] = ["AC-001"]
        fixture_ir["nonGoals"] = ["No production business feature in the Harness fixture"]
        fixture_ir_path.write_text(yaml.safe_dump(fixture_ir, allow_unicode=True, sort_keys=False), encoding="utf-8")
        if run([sys.executable, str(validator), "--root", str(fixture), "--ir-only"]):
            return 1

        scaffold = fixture / "fixture-plugin"
        if run([sys.executable, str(scaffolder), "--root", str(fixture)]):
            return 1
        if run([sys.executable, str(linter), "--root", str(scaffold)]):
            return 1
        if run([sys.executable, str(plugin_validator), str(scaffold)]):
            return 1

        node = shutil.which("node")
        if node:
            node_files = [
                scaffold / "server" / "storage.mjs",
                scaffold / "server" / "index.mjs",
                scaffold / "ui" / "app.js",
                scaffold / "scripts" / "probe-mcp.mjs",
                scaffold / "tests" / "storage.test.mjs",
            ]
            for path in node_files:
                if run([node, "--check", str(path)]):
                    return 1
            if run([node, "--test", str(scaffold / "tests" / "storage.test.mjs")]):
                return 1
            if run([node, "--check", str(scripts / "audit-ui.mjs")]):
                return 1
        else:
            print("Harness validation warning: node not found; generated JavaScript checks skipped.")

    print(f"Harness validation passed: {root}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
