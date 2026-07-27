import { Router, type Router as RouterType } from "express";
import { WorkflowService } from "../services/workflowService.js";
import { statusOf, messageOf } from "../utils/httpError.js";

const router: RouterType = Router();
const service = new WorkflowService();

router.get("/", async (req, res) => {
  const project = (req.query.project as string) || process.cwd();
  const workflows = await service.listWorkflows(project);
  res.json({ workflows });
});

router.get("/:id", async (req, res) => {
  const project = (req.query.project as string) || process.cwd();
  const workflow = await service.getWorkflow(project, req.params.id);
  if (!workflow) {
    return res.status(404).json({ error: { code: "FILE_NOT_FOUND", message: "Workflow not found" } });
  }
  res.json(workflow);
});

router.post("/", async (req, res) => {
  const project = (req.query.project as string) || process.cwd();
  try {
    const id = await service.saveWorkflow(project, req.body);
    res.json({ id });
  } catch (err) {
    // 校验错误(assertValidWorkflow / assertSafeName)自带 400，透传出去；
    // 原先一律按 500 + String(err) 返回，界面只能显示「Error: 第 1 步引用了…」
    // 这种带 Error 前缀的内部文案，且看起来像服务器故障而非用户可纠正的问题。
    const status = statusOf(err);
    res.status(status).json({
      error: {
        code: status === 500 ? "PROCESS_ERROR" : "INVALID_WORKFLOW",
        message: messageOf(err, "保存工作流失败"),
      },
    });
  }
});

router.delete("/:id", async (req, res) => {
  const project = (req.query.project as string) || process.cwd();
  const ok = await service.deleteWorkflow(project, req.params.id);
  res.json({ success: ok });
});

export default router;
