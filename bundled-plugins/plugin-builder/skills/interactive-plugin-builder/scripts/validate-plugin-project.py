#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

try:
    import yaml
except ImportError as exc:
    raise SystemExit("PyYAML is required: python3 -m pip install --user pyyaml jsonschema") from exc

try:
    from jsonschema import Draft202012Validator, FormatChecker
except ImportError as exc:
    raise SystemExit("jsonschema is required: python3 -m pip install --user pyyaml jsonschema") from exc

PHASE_ORDER = {
    "IDEA": 0,
    "SPEC_READY": 1,
    "DESIGN_READY": 2,
    "PLAN_READY": 3,
    "BUILDING": 4,
    "CHECKING": 5,
    "COMPLETE": 6,
}

REQUIRED_BY_PHASE = {
    "SPEC_READY": [
        "Plugin-Spec.md",
        "Plugin-Spec-CHANGELOG.md",
        "plugin.yaml",
    ],
    "DESIGN_READY": ["Plugin-Design.md"],
    "PLAN_READY": ["PLUGIN-DEV-PLAN.md"],
    "COMPLETE": ["Plugin-Check-Report.md"],
}

QUALITY_BY_PHASE = {
    "IDEA": {"NOT_CHECKED", "FAIL", "BLOCKED_EXTERNAL"},
    "SPEC_READY": {"SPEC_VALID", "FAIL", "BLOCKED_EXTERNAL"},
    "DESIGN_READY": {"DESIGN_VALID", "FAIL", "BLOCKED_EXTERNAL"},
    "PLAN_READY": {"PLAN_VALID", "FAIL", "BLOCKED_EXTERNAL"},
    "BUILDING": {"PLAN_VALID", "FAIL", "BLOCKED_EXTERNAL"},
    "CHECKING": {"NOT_CHECKED", "FAIL", "BUILD_VALID", "HOST_VERIFIED", "BLOCKED_EXTERNAL"},
    "COMPLETE": {"SHIPPABLE"},
}

REQ_ID_PATTERN = re.compile(r"\b(?:REQ|UX|HOST|DATA|SEC|NFR|AC)-\d{3,}\b")
AC_PATTERN = re.compile(r"\bAC-\d{3,}\b")
PLACEHOLDER_PATTERNS = [
    re.compile(r"\breplace-me\b", re.IGNORECASE),
    re.compile(r"\bReplace Me\b"),
    re.compile(
        r"\[(?:内容|值|路径|待填写|target id|Plugin Name|名称或暂定名|"
        r"plugin-id|one observable Plugin outcome|primary user|core outcome|"
        r"why direct manipulation is necessary)[^\]]*\]",
        re.IGNORECASE,
    ),
]


@dataclass(frozen=True)
class Finding:
    severity: str
    code: str
    message: str
    path: str | None = None


def skill_dir() -> Path:
    return Path(__file__).resolve().parents[1]


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def load_yaml(path: Path) -> Any:
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def extract_yaml_block(path: Path) -> Any:
    text = path.read_text(encoding="utf-8")
    match = re.search(r"```ya?ml\s*\n(.*?)\n```", text, re.DOTALL | re.IGNORECASE)
    if not match:
        raise ValueError("没有找到 ```yaml 机器状态 block")
    return yaml.safe_load(match.group(1))


def validate_schema(instance: Any, schema_path: Path, label: str, findings: list[Finding]) -> None:
    schema = load_json(schema_path)
    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    errors = sorted(validator.iter_errors(instance), key=lambda item: [str(part) for part in item.absolute_path])
    for error in errors:
        location = ".".join(str(part) for part in error.absolute_path) or "<root>"
        findings.append(Finding("ERROR", "SCHEMA", f"{label}.{location}: {error.message}", label))


def phase_at_least(phase: str, threshold: str) -> bool:
    return PHASE_ORDER.get(phase, -1) >= PHASE_ORDER[threshold]


def find_placeholders(path: Path) -> list[str]:
    if not path.is_file():
        return []
    text = path.read_text(encoding="utf-8")
    matches: set[str] = set()
    for pattern in PLACEHOLDER_PATTERNS:
        matches.update(match.group(0) for match in pattern.finditer(text))
    return sorted(matches)


def section_text(text: str, section: str) -> str:
    lines = text.splitlines()
    start: int | None = None
    for index, line in enumerate(lines):
        if line.strip() == f"[{section}]" and not line.startswith(" "):
            start = index + 1
            break
    if start is None:
        return ""
    end = len(lines)
    for index in range(start, len(lines)):
        if re.fullmatch(r"\[[^\]]+\]", lines[index].strip()) and not lines[index].startswith(" "):
            end = index
            break
    return "\n".join(lines[start:end])


def p0_is_clear(spec_text: str) -> bool:
    open_questions = section_text(spec_text, "Open Questions")
    if not open_questions:
        return False
    match = re.search(r"^\s*P0[：:]\s*(.*?)(?=^\s*P1[：:]|\Z)", open_questions, re.MULTILINE | re.DOTALL)
    if not match:
        return False
    return bool(re.search(r"(?:^|\n)\s*-\s*(?:None|无|none)\s*$", match.group(1), re.IGNORECASE))


def document_has_status(path: Path, expected: str) -> bool:
    if not path.is_file():
        return False
    text = path.read_text(encoding="utf-8")
    return bool(re.search(rf"(?:Status|状态)[：:]\s*{re.escape(expected)}\s*$", text, re.IGNORECASE | re.MULTILINE))


def validate_ir(
    data: Any,
    schema_dir: Path,
    findings: list[Finding],
    *,
    draft: bool,
    require_render: bool = True,
) -> dict[str, Any] | None:
    if not isinstance(data, dict):
        findings.append(Finding("ERROR", "IR_TYPE", "plugin.yaml 顶层必须是映射。", "plugin.yaml"))
        return None

    validate_schema(data, schema_dir / "plugin.schema.json", "plugin.yaml", findings)

    targets = data.get("targets", {})
    if isinstance(targets, dict):
        required_targets = [
            target_id
            for target_id, config in targets.items()
            if isinstance(config, dict) and config.get("tier") == "required"
        ]
        if not required_targets:
            findings.append(Finding("ERROR", "TARGET_REQUIRED", "至少需要一个 required target。", "plugin.yaml"))
        for target_id in required_targets:
            if targets[target_id].get("requiredStatus") != "HOST_VERIFIED":
                findings.append(
                    Finding(
                        "ERROR",
                        "TARGET_GATE",
                        f"required target {target_id} 的 requiredStatus 必须是 HOST_VERIFIED。",
                        "plugin.yaml",
                    )
                )

    state_config = data.get("state", {})
    paths = data.get("paths", {})
    if isinstance(state_config, dict) and isinstance(paths, dict):
        if state_config.get("directory") != paths.get("stateDirectory"):
            findings.append(Finding("ERROR", "STATE_PATH", "state.directory 与 paths.stateDirectory 必须一致。", "plugin.yaml"))

    acceptance = data.get("acceptance", {})
    required_acceptance = acceptance.get("required", []) if isinstance(acceptance, dict) else []
    optional_acceptance = acceptance.get("optional", []) if isinstance(acceptance, dict) else []
    overlap = sorted(set(required_acceptance) & set(optional_acceptance))
    if overlap:
        findings.append(Finding("ERROR", "AC_DUPLICATE", f"AC 不能同时 required 与 optional：{overlap}", "plugin.yaml"))
    if not draft and not required_acceptance:
        findings.append(Finding("ERROR", "AC_REQUIRED", "收敛后的 plugin.yaml 至少需要一个 acceptance.required。", "plugin.yaml"))

    mcp = data.get("mcp", {})
    if require_render and not draft and isinstance(mcp, dict) and not mcp.get("renderTool"):
        findings.append(Finding("ERROR", "RENDER_TOOL_REQUIRED", "收敛后的 plugin.yaml 必须定义 mcp.renderTool。", "plugin.yaml"))
    seen: dict[str, str] = {}
    if isinstance(mcp, dict):
        for group in ("appOnlyTools", "agentTools", "longRunningTools"):
            values = mcp.get(group, [])
            if not isinstance(values, list):
                continue
            for name in values:
                if name in seen:
                    findings.append(Finding("ERROR", "TOOL_DUPLICATE", f"Tool {name} 同时出现在 {seen[name]} 与 {group}。", "plugin.yaml"))
                seen[name] = group

    jobs = data.get("jobs", {})
    if isinstance(jobs, dict) and not jobs.get("enabled"):
        for field in ("cancel", "retry", "reconnect"):
            if jobs.get(field):
                findings.append(Finding("ERROR", "JOBS_DISABLED", f"jobs.enabled=false 时 {field} 不能为 true。", "plugin.yaml"))

    return data


def validate_project(
    root: Path,
    *,
    soft: bool = False,
    ir_only: bool = False,
    draft: bool = False,
) -> tuple[list[Finding], dict[str, Any]]:
    findings: list[Finding] = []
    summary: dict[str, Any] = {"root": str(root), "phase": None, "qualityGate": None, "targets": {}}
    schema_dir = skill_dir() / "schemas"

    plugin_path = root / "plugin.yaml"
    if plugin_path.is_file():
        try:
            plugin_ir = validate_ir(
                load_yaml(plugin_path),
                schema_dir,
                findings,
                draft=draft or soft,
                require_render=ir_only,
            )
        except Exception as exc:
            plugin_ir = None
            findings.append(Finding("ERROR", "IR_PARSE", str(exc), plugin_path.name))
    else:
        plugin_ir = None
        findings.append(Finding("WARNING" if soft else "ERROR", "IR_MISSING", "缺少 plugin.yaml。", plugin_path.name))

    if ir_only:
        placeholders = find_placeholders(plugin_path)
        if placeholders:
            findings.append(
                Finding(
                    "WARNING" if draft or soft else "ERROR",
                    "PLACEHOLDER",
                    f"仍有模板占位符：{placeholders[:8]}",
                    plugin_path.name,
                )
            )
        return findings, summary

    state_path = root / "Plugin-Project-State.md"
    if state_path.is_file():
        try:
            state = extract_yaml_block(state_path)
            validate_schema(state, schema_dir / "project-state.schema.json", state_path.name, findings)
        except Exception as exc:
            state = None
            findings.append(Finding("ERROR", "STATE_PARSE", str(exc), state_path.name))
    else:
        state = None
        findings.append(Finding("WARNING" if soft else "ERROR", "STATE_MISSING", "缺少 Plugin-Project-State.md。", state_path.name))

    phase = state.get("phase", "IDEA") if isinstance(state, dict) else "IDEA"
    quality_gate = state.get("qualityGate", "NOT_CHECKED") if isinstance(state, dict) else "NOT_CHECKED"
    summary["phase"] = phase
    summary["qualityGate"] = quality_gate
    summary["targets"] = state.get("targets", {}) if isinstance(state, dict) else {}

    if phase not in PHASE_ORDER:
        findings.append(Finding("ERROR", "PHASE_INVALID", f"未知 phase：{phase}", state_path.name))
    else:
        if quality_gate not in QUALITY_BY_PHASE[phase]:
            findings.append(Finding("ERROR", "QUALITY_PHASE", f"phase={phase} 不允许 qualityGate={quality_gate}。", state_path.name))
        for threshold, filenames in REQUIRED_BY_PHASE.items():
            if phase_at_least(phase, threshold):
                for filename in filenames:
                    if not (root / filename).is_file():
                        findings.append(Finding("ERROR", "ARTIFACT_MISSING", f"phase={phase} 需要 {filename}。", filename))

    spec_path = root / "Plugin-Spec.md"
    spec_text = spec_path.read_text(encoding="utf-8") if spec_path.is_file() else ""
    spec_ids = set(REQ_ID_PATTERN.findall(spec_text))
    spec_acs = set(AC_PATTERN.findall(spec_text))

    spec_form: str | None = None
    if phase_at_least(phase, "SPEC_READY"):
        if not document_has_status(spec_path, "SPEC_READY"):
            findings.append(Finding("ERROR", "SPEC_STATUS", "Plugin-Spec.md Status 必须是 SPEC_READY。", spec_path.name))
        if not p0_is_clear(spec_text):
            findings.append(Finding("ERROR", "P0_OPEN", "Plugin-Spec.md 的 [Open Questions] P0 必须明确为 None / 无。", spec_path.name))
        if not spec_acs:
            findings.append(Finding("ERROR", "AC_MISSING", "Plugin-Spec.md 没有发现 AC-XXX。", spec_path.name))
        form_section = section_text(spec_text, "开发形态")
        form_match = re.search(r"^\s*-\s*Form[：:]\s*(\S+)\s*$", form_section, re.MULTILINE)
        spec_form = form_match.group(1) if form_match else None
        if spec_form not in {"companion-web-app", "mcp-app", "hybrid"}:
            findings.append(
                Finding(
                    "ERROR",
                    "SPEC_FORM",
                    "Plugin-Spec.md 的 [开发形态] 必须写明单一 Form 取值（companion-web-app / mcp-app / hybrid），形态未判定不得 SPEC_READY。",
                    spec_path.name,
                )
            )
            spec_form = None

    if phase_at_least(phase, "DESIGN_READY") and not document_has_status(root / "Plugin-Design.md", "DESIGN_READY"):
        findings.append(Finding("ERROR", "DESIGN_STATUS", "Plugin-Design.md Status 必须是 DESIGN_READY。", "Plugin-Design.md"))
    if phase_at_least(phase, "PLAN_READY") and not document_has_status(root / "PLUGIN-DEV-PLAN.md", "PLAN_READY"):
        findings.append(Finding("ERROR", "PLAN_STATUS", "PLUGIN-DEV-PLAN.md Status 必须是 PLAN_READY。", "PLUGIN-DEV-PLAN.md"))

    if isinstance(plugin_ir, dict):
        plugin_block = plugin_ir.get("plugin") if isinstance(plugin_ir.get("plugin"), dict) else {}
        plugin_id = plugin_block.get("id")
        targets = plugin_ir.get("targets") if isinstance(plugin_ir.get("targets"), dict) else {}
        acceptance_block = plugin_ir.get("acceptance") if isinstance(plugin_ir.get("acceptance"), dict) else {}
        required_list = acceptance_block.get("required") if isinstance(acceptance_block.get("required"), list) else []
        optional_list = acceptance_block.get("optional") if isinstance(acceptance_block.get("optional"), list) else []
        required_acs = set(required_list)
        optional_acs = set(optional_list)

        if phase_at_least(phase, "SPEC_READY") and not required_acs:
            findings.append(Finding("ERROR", "AC_IR_EMPTY", "SPEC_READY 后 plugin.yaml acceptance.required 不能为空。", plugin_path.name))
        ir_form = plugin_block.get("form")
        if phase_at_least(phase, "SPEC_READY") and spec_form and ir_form != spec_form:
            findings.append(
                Finding(
                    "ERROR",
                    "FORM_MISMATCH",
                    f"plugin.yaml plugin.form（{ir_form}）与 Plugin-Spec.md [开发形态] 的 Form（{spec_form}）不一致。",
                    plugin_path.name,
                )
            )
        missing_acs = sorted((required_acs | optional_acs) - spec_acs)
        if missing_acs and phase_at_least(phase, "SPEC_READY"):
            findings.append(Finding("ERROR", "AC_IR_MISMATCH", f"plugin.yaml AC 未在 Spec 中定义：{missing_acs}", plugin_path.name))

        if isinstance(state, dict):
            if state.get("pluginId") != plugin_id:
                findings.append(Finding("ERROR", "PLUGIN_ID_MISMATCH", "Project State pluginId 与 plugin.yaml plugin.id 不一致。", state_path.name))
            state_targets = state.get("targets", {})
            if isinstance(targets, dict) and set(state_targets) != set(targets):
                findings.append(Finding("ERROR", "STATE_TARGET_MISMATCH", "Project State targets 与 plugin.yaml targets 不一致。", state_path.name))
            if isinstance(targets, dict):
                for target_id, config in targets.items():
                    if target_id not in state_targets:
                        continue
                    if state_targets[target_id].get("tier") != config.get("tier"):
                        findings.append(Finding("ERROR", "STATE_TARGET_TIER", f"{target_id} tier 在 State 与 IR 不一致。", state_path.name))
                    if state_targets[target_id].get("status") == "HOST_VERIFIED" and not state_targets[target_id].get("evidence"):
                        findings.append(Finding("ERROR", "HOST_EVIDENCE_EMPTY", f"{target_id} 已标 HOST_VERIFIED，但没有 evidence refs。", state_path.name))

        if phase_at_least(phase, "DESIGN_READY"):
            contracts = plugin_ir.get("contracts", {})
            if isinstance(contracts, dict):
                for key, relative in contracts.items():
                    contract_path = root / str(relative).removeprefix("./")
                    if not contract_path.is_file():
                        findings.append(Finding("ERROR", "CONTRACT_MISSING", f"缺少 {key}：{relative}", str(relative)))
                        continue
                    if contract_path.suffix == ".json":
                        try:
                            load_json(contract_path)
                        except Exception as exc:
                            findings.append(Finding("ERROR", "CONTRACT_JSON", f"{relative} JSON 无效：{exc}", str(relative)))
            if plugin_ir.get("mcp", {}).get("renderTool") is None:
                findings.append(Finding("ERROR", "RENDER_TOOL_REQUIRED", "DESIGN_READY 之后 mcp.renderTool 不能是 null。", plugin_path.name))
            plugin_form = plugin_block.get("form")
            mcp_block = plugin_ir.get("mcp") if isinstance(plugin_ir.get("mcp"), dict) else {}
            resource_items = mcp_block.get("resources") if isinstance(mcp_block.get("resources"), list) else []
            ui_resources = [item for item in resource_items if isinstance(item, dict) and str(item.get("uri", "")).startswith("ui://")]
            if plugin_form in {"mcp-app", "hybrid"} and not ui_resources:
                findings.append(
                    Finding(
                        "ERROR",
                        "FORM_UI_RESOURCE",
                        "plugin.form 为 mcp-app / hybrid 时，DESIGN_READY 之后 mcp.resources 必须登记至少一个 ui:// resource。",
                        plugin_path.name,
                    )
                )

        if quality_gate == "SHIPPABLE" or phase == "COMPLETE":
            state_targets = state.get("targets", {}) if isinstance(state, dict) else {}
            required_targets = [target_id for target_id, config in targets.items() if isinstance(config, dict) and config.get("tier") == "required"]
            for target_id in required_targets:
                status = (state_targets.get(target_id) or {}).get("status")
                if status != "HOST_VERIFIED":
                    findings.append(Finding("ERROR", "HOST_NOT_VERIFIED", f"required target {target_id} 状态是 {status}，不能 SHIPPABLE。", state_path.name))

            report_path = root / "Plugin-Check-Report.md"
            if not report_path.is_file() or not re.search(r"Final Status[：:]\s*SHIPPABLE", report_path.read_text(encoding="utf-8")):
                findings.append(Finding("ERROR", "REPORT_STATUS", "Project State 是 SHIPPABLE，但 Check Report 未显示 Final Status：SHIPPABLE。", report_path.name))

            evidence_relative = plugin_ir["paths"].get("evidenceIndex") if isinstance(plugin_ir.get("paths"), dict) else None
            if evidence_relative:
                evidence_path = root / str(evidence_relative).removeprefix("./")
                if not evidence_path.is_file():
                    findings.append(Finding("ERROR", "EVIDENCE_MISSING", f"缺少 Evidence Index：{evidence_relative}", str(evidence_relative)))
                else:
                    try:
                        evidence = load_json(evidence_path)
                        validate_schema(evidence, schema_dir / "evidence.schema.json", str(evidence_relative), findings)
                        if isinstance(evidence, dict) and evidence.get("pluginId") != plugin_id:
                            findings.append(Finding("ERROR", "EVIDENCE_PLUGIN_ID", "Evidence pluginId 与 plugin.yaml 不一致。", str(evidence_relative)))
                    except Exception as exc:
                        findings.append(Finding("ERROR", "EVIDENCE_PARSE", str(exc), str(evidence_relative)))

    for filename in ["Plugin-Spec.md", "Plugin-Design.md", "PLUGIN-DEV-PLAN.md", "plugin.yaml"]:
        path = root / filename
        placeholders = find_placeholders(path)
        if placeholders:
            severity = "WARNING" if soft or phase == "IDEA" else "ERROR"
            findings.append(Finding(severity, "PLACEHOLDER", f"仍有模板占位符：{placeholders[:8]}", filename))

    if isinstance(state, dict):
        for key, relative in (state.get("artifacts") if isinstance(state.get("artifacts"), dict) else {}).items():
            if not relative:
                continue
            path = root / relative
            if key in {"interviewNotes", "spec", "specChangelog", "ir"} and phase_at_least(phase, "SPEC_READY") and not path.is_file():
                findings.append(Finding("ERROR", "STATE_ARTIFACT", f"Project State 引用不存在文件：{relative}", state_path.name))
            if key == "design" and phase_at_least(phase, "DESIGN_READY") and not path.is_file():
                findings.append(Finding("ERROR", "STATE_ARTIFACT", f"Project State 引用不存在文件：{relative}", state_path.name))
            if key == "plan" and phase_at_least(phase, "PLAN_READY") and not path.is_file():
                findings.append(Finding("ERROR", "STATE_ARTIFACT", f"Project State 引用不存在文件：{relative}", state_path.name))
            if key in {"checkReport", "evidenceIndex"} and phase == "COMPLETE" and not path.is_file():
                findings.append(Finding("ERROR", "STATE_ARTIFACT", f"Project State 引用不存在文件：{relative}", state_path.name))

    if phase_at_least(phase, "SPEC_READY") and len(spec_ids) < len(spec_acs):
        findings.append(Finding("WARNING", "ID_REVIEW", "Spec ID 索引异常，请检查 Requirement 与 AC 编号。", spec_path.name))

    return findings, summary


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--soft", action="store_true", help="IDEA / drafting 模式：将非阻断缺口降为 Warning。")
    parser.add_argument("--ir-only", action="store_true", help="只校验 plugin.yaml。")
    parser.add_argument("--draft", action="store_true", help="允许 plugin.yaml 尚未填入 required AC。")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    root = args.root.resolve()
    findings, summary = validate_project(root, soft=args.soft, ir_only=args.ir_only, draft=args.draft)
    errors = [item for item in findings if item.severity == "ERROR"]
    payload = {
        "ok": not errors,
        "summary": summary,
        "findings": [asdict(item) for item in findings],
    }

    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print(f"Plugin project validation: {'PASS' if not errors else 'FAIL'}")
        print(f"- Root: {root}")
        if not args.ir_only:
            print(f"- Phase: {summary['phase']}")
            print(f"- Quality Gate: {summary['qualityGate']}")
        for item in findings:
            prefix = "ERROR" if item.severity == "ERROR" else "WARN"
            location = f" ({item.path})" if item.path else ""
            print(f"- [{prefix}] {item.code}{location}: {item.message}")

    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
