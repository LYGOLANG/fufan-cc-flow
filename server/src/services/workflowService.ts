import fs from "fs/promises";
import path from "path";
// 名称来自 HTTP 请求且被直接 path.join 进目录,一律先过 assertSafeName
import { assertSafeName } from "../utils/pathUtils.js";

// 类型定义收口在 workflow/types.ts —— 此前这里内联了一份，与前端各存一份，
// 加字段时容易只改一边。
import type { Workflow } from "./workflow/types.js";
import { assertValidWorkflow, extractReferencedVars } from "./workflow/validate.js";

export class WorkflowService {
  private getWorkflowsDir(projectPath: string): string {
    return path.join(projectPath, ".claude", "workflows");
  }

  async listWorkflows(projectPath: string): Promise<Workflow[]> {
    const dir = this.getWorkflowsDir(projectPath);
    try {
      const entries = await fs.readdir(dir);
      const workflows: Workflow[] = [];

      for (const entry of entries) {
        if (!entry.endsWith(".json")) continue;
        try {
          const raw = await fs.readFile(path.join(dir, entry), "utf-8");
          workflows.push(JSON.parse(raw));
        } catch {
          // Skip invalid files
        }
      }

      // 按名称排序。此前直接返回 fs.readdir 的顺序 —— 那是文件系统的目录项
      // 顺序,而文件名是 wf_<时间戳>.json,和用户看到的工作流名称毫无关系,
      // 所以列表看起来完全随机(用户给工作流编了 ①②③,显示出来却是 ③②①⑥⑤④)。
      // 用 localeCompare 以支持中文与序号字符的自然顺序。
      return workflows.sort((a, b) =>
        (a.name ?? "").localeCompare(b.name ?? "", "zh-CN", { numeric: true })
      );
    } catch {
      return [];
    }
  }

  async getWorkflow(
    projectPath: string,
    id: string
  ): Promise<Workflow | null> {
    assertSafeName(id, "工作流 id");
    const filePath = path.join(this.getWorkflowsDir(projectPath), `${id}.json`);
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async saveWorkflow(
    projectPath: string,
    workflow: Workflow
  ): Promise<string> {
    const dir = this.getWorkflowsDir(projectPath);
    await fs.mkdir(dir, { recursive: true });

    if (!workflow.id) {
      workflow.id = `wf_${Date.now()}`;
    }

    // 自动推导「运行前需要用户填写的输入变量」。
    //
    // 两处此前的问题:
    // 1. 原正则是 /\$[A-Z_]+/g,只认大写 —— 而引擎的 substituteVariables 支持
    //    大小写,于是 $sell 这类写法会被替换、却从不出现在变量列表里。
    // 2. 它把提示词里引用的**全部**变量都当成输入变量。编排上线后这会出错:
    //    第二步引用第一步的输出变量 $sell,却被当成「运行前要用户填的值」,
    //    平白多出一个不该填的输入框。
    //
    // 正确定义:被引用、且没有任何步骤产出它 —— 那才需要用户提供。
    const produced = new Set(
      workflow.steps.map((s) => s.outputVar?.trim()).filter((v): v is string => !!v)
    );
    const referenced = new Set<string>();
    for (const step of workflow.steps) {
      for (const name of extractReferencedVars(step.prompt ?? "")) referenced.add(name);
    }
    workflow.variables = [...referenced].filter((n) => !produced.has(n));

    // 服务端校验:前端的即时提示只是体验，请求可以绕过界面直接发。
    // 放在变量推导之后 —— 校验依赖 variables 判断「输入变量在第一步即可引用」。
    assertValidWorkflow(workflow);

    const filePath = path.join(dir, `${workflow.id}.json`);
    await fs.writeFile(filePath, JSON.stringify(workflow, null, 2), "utf-8");

    return workflow.id;
  }

  async deleteWorkflow(
    projectPath: string,
    id: string
  ): Promise<boolean> {
    assertSafeName(id, "工作流 id");
    try {
      await fs.unlink(
        path.join(this.getWorkflowsDir(projectPath), `${id}.json`)
      );
      return true;
    } catch {
      return false;
    }
  }
}
