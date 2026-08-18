#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

PLUGIN_NAME = "interactive-plugin-builder"
EXCLUDED_TOP_LEVEL = {"dist", ".git"}


def discover_source_root(script: Path) -> Path:
    for candidate in script.resolve().parents:
        if (candidate / ".claude-plugin" / "plugin.json").is_file():
            return candidate
    raise SystemExit("只能从包含 .claude-plugin/plugin.json 的 Harness 根打包。")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def copytree_clean(source: Path, destination: Path) -> None:
    shutil.copytree(
        source,
        destination,
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc", ".DS_Store"),
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    script = Path(__file__).resolve()
    root = (args.root or discover_source_root(script)).resolve()
    output_root = (args.output or root / "dist").resolve()
    package = output_root / PLUGIN_NAME
    archive = output_root / f"{PLUGIN_NAME}-claude-plugin.zip"
    hash_file = output_root / f"{archive.name}.sha256"

    validate_harness = root / "skills" / PLUGIN_NAME / "scripts" / "validate-harness.py"
    checked = subprocess.run([sys.executable, str(validate_harness), "--root", str(root)], check=False)
    if checked.returncode:
        return checked.returncode

    manifest = json.loads((root / ".claude-plugin" / "plugin.json").read_text(encoding="utf-8"))

    output_root.mkdir(parents=True, exist_ok=True)
    if package.exists():
        shutil.rmtree(package)
    package.mkdir(parents=True)
    for entry in sorted(root.iterdir()):
        if entry.name in EXCLUDED_TOP_LEVEL or entry.name == ".DS_Store":
            continue
        if entry.resolve() == output_root:
            continue
        if entry.is_dir():
            copytree_clean(entry, package / entry.name)
        else:
            shutil.copyfile(entry, package / entry.name)

    linter = package / "skills" / PLUGIN_NAME / "scripts" / "lint-harness-style.py"
    if subprocess.run([sys.executable, str(linter), "--root", str(package)], check=False).returncode:
        return 1

    inventory = []
    for path in sorted(package.rglob("*")):
        if path.is_file() and path.name != "PACKAGE-MANIFEST.json":
            inventory.append(
                {
                    "path": path.relative_to(package).as_posix(),
                    "size": path.stat().st_size,
                    "sha256": sha256(path),
                }
            )
    package_manifest = {
        "schemaVersion": 1,
        "name": manifest["name"],
        "version": manifest.get("version"),
        "files": inventory,
    }
    (package / "PACKAGE-MANIFEST.json").write_text(
        json.dumps(package_manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    checksum_lines = []
    for path in sorted(package.rglob("*")):
        if path.is_file() and path.name != "MANIFEST.sha256":
            checksum_lines.append(f"{sha256(path)}  {path.relative_to(package).as_posix()}")
    (package / "MANIFEST.sha256").write_text("\n".join(checksum_lines) + "\n", encoding="utf-8")

    plugin_validator = package / "skills" / PLUGIN_NAME / "scripts" / "validate-claude-plugin.py"
    if subprocess.run(
        [
            sys.executable,
            str(plugin_validator),
            str(package),
            "--require-package-manifest",
            "--require-checksum-manifest",
        ],
        check=False,
    ).returncode:
        return 1

    if archive.exists():
        archive.unlink()
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(package.rglob("*")):
            if path.is_file():
                zf.write(path, Path(PLUGIN_NAME) / path.relative_to(package))

    archive_hash = sha256(archive)
    hash_file.write_text(f"{archive_hash}  {archive.name}\n", encoding="utf-8")
    print(f"Plugin package: {package}")
    print(f"Plugin archive: {archive}")
    print(f"Plugin SHA-256: {archive_hash}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
