import type { Workflow } from "../types/workflow";

/**
 * 工作流校验 —— 前端副本。
 *
 * ⚠️ 规则必须与 `server/src/services/workflow/validate.ts` 保持一致。
 * 两边各有一份是因为前端不能 import 服务端代码（构建目标不同），但**服务端
 * 那份才是闸门**：前端这份只为编辑时即时提示，请求可以绕过界面直接发。
 *
 * 改动任何一边时都要同步另一边。两处都有测试，行为不一致会被测出来。
 */

const VAR_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface ValidationIssue {
  stepIndex: number;
  message: string;
}

/** 从提示词里提取被引用的变量名 */
export function extractReferencedVars(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/\$([A-Za-z_][A-Za-z0-9_]*)/g)) {
    found.add(m[1]);
  }
  return [...found];
}

export function validateWorkflowDraft(wf: Workflow | Omit<Workflow, "id">): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!wf.name?.trim()) {
    issues.push({ stepIndex: -1, message: "工作流名称不能为空" });
  }
  if (!Array.isArray(wf.steps) || wf.steps.length === 0) {
    issues.push({ stepIndex: -1, message: "至少需要一个步骤" });
    return issues;
  }

  const available = new Set<string>(wf.variables ?? []);

  // 先预扫「哪个变量由第几步产出」，好把「引用了后面步骤的变量」和
  // 「引用了根本不存在的变量」区分开 —— 两者给用户的指引完全不同。
  const producedBy = new Map<string, number>();
  wf.steps.forEach((step, i) => {
    const out = step.outputVar?.trim();
    if (out && !producedBy.has(out)) producedBy.set(out, i);
  });

  wf.steps.forEach((step, i) => {
    if (!step.prompt?.trim()) {
      issues.push({ stepIndex: i, message: `第 ${i + 1} 步的提示词不能为空` });
    }

    for (const name of extractReferencedVars(step.prompt ?? "")) {
      if (!available.has(name)) {
        const later = producedBy.get(name);
        issues.push({
          stepIndex: i,
          message:
            later !== undefined
              ? `第 ${i + 1} 步引用了 $${name}，但它由第 ${later + 1} 步产出（在它之后）`
              : `第 ${i + 1} 步引用了 $${name}，但没有任何步骤产出它，也不是输入变量`,
        });
      }
    }

    const out = step.outputVar?.trim();
    if (out) {
      if (!VAR_NAME_RE.test(out)) {
        issues.push({
          stepIndex: i,
          message: `第 ${i + 1} 步的输出变量名「${out}」不合法（只能用字母、数字、下划线，且不以数字开头）`,
        });
      } else if (available.has(out)) {
        issues.push({
          stepIndex: i,
          message: `第 ${i + 1} 步的输出变量 $${out} 与已有变量重名，会覆盖它`,
        });
      } else {
        available.add(out);
      }
    }
  });

  return issues;
}
