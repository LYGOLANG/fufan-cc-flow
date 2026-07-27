import type { Workflow } from "./types.js";

/**
 * 工作流保存前的校验。
 *
 * 抽成纯函数是因为它要在两处执行:编辑器里即时提示，服务端保存时再拦一道。
 * 前端校验只是体验，**不可信** —— 请求可以绕过界面直接发。
 *
 * 只校验「结构上不可能跑通」的问题，不猜测语义:提示词写得好不好、Agent 选得
 * 对不对不在这里管，那是用户的判断。
 */

/** 变量名允许的形式:字母数字下划线，且不以数字开头 */
const VAR_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface ValidationIssue {
  /** 出问题的步骤序号（从 0 起）；与整体相关时为 -1 */
  stepIndex: number;
  message: string;
}

/** 从提示词里提取被引用的变量名 */
export function extractReferencedVars(text: string): string[] {
  const found = new Set<string>();
  // $name —— 与 substituteVariables 的替换语法保持一致
  for (const m of text.matchAll(/\$([A-Za-z_][A-Za-z0-9_]*)/g)) {
    found.add(m[1]);
  }
  return [...found];
}

export function validateWorkflow(wf: Workflow): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!wf.name?.trim()) {
    issues.push({ stepIndex: -1, message: "工作流名称不能为空" });
  }
  if (!Array.isArray(wf.steps) || wf.steps.length === 0) {
    issues.push({ stepIndex: -1, message: "至少需要一个步骤" });
    return issues;
  }

  // 运行前填写的输入变量，在第一步之前就已可用
  const available = new Set<string>(wf.variables ?? []);

  // 先预扫「哪个变量由第几步产出」。必须在主循环之前完成 —— 否则校验到第 i 步
  // 时这张表还是空的，「引用了后面步骤产出的变量」就只能报成「没人产出它」，
  // 而这两种情况给用户的指引完全不同。
  const producedBy = new Map<string, number>();
  wf.steps.forEach((step, i) => {
    const out = step.outputVar?.trim();
    if (out && !producedBy.has(out)) producedBy.set(out, i);
  });

  wf.steps.forEach((step, i) => {
    if (!step.prompt?.trim()) {
      issues.push({ stepIndex: i, message: `第 ${i + 1} 步的提示词不能为空` });
    }

    // 引用校验:必须在**当前步骤之前**已产出。
    // 这是编排最容易踩的坑——引用了后面步骤的变量，运行时会静默替换成空串
    // 或原样留下 $name，两种都让这一步的提示词变得莫名其妙。
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

    // 输出变量校验
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

/** 校验并在有问题时抛错（服务端保存路径用） */
export function assertValidWorkflow(wf: Workflow): void {
  const issues = validateWorkflow(wf);
  if (issues.length > 0) {
    throw Object.assign(new Error(issues.map((i) => i.message).join("；")), {
      statusCode: 400,
    });
  }
}
