import { useEffect, useState } from "react";
import {
  GitMerge,
  Plus,
  Play,
  Pencil,
  Trash2,
  X,
  Save,
  ArrowRight,
  Loader2,
  Bot,
} from "lucide-react";
import { useWorkflowStore, type WorkflowRunState } from "../../stores/workflowStore";
import { useAgentStore } from "../../stores/agentStore";
import { useUIStore } from "../../stores/uiStore";
import { wsService } from "../../services/websocket";
import { buildEngineParams } from "../../utils/sendPayload";
import { validateWorkflowDraft, extractReferencedVars } from "../../utils/workflowValidate";
import type { Workflow, WorkflowStep } from "../../types/workflow";

export default function WorkflowManager() {
  const {
    workflows, loading, editing,
    loadWorkflows, saveWorkflow, deleteWorkflow, setEditing, createNew,
  } = useWorkflowStore();
  const { projectAgents, userAgents } = useAgentStore();
  // 注意:selector 里不能返回 filter/map 产生的新数组——zustand v5 基于
  // useSyncExternalStore,每次 getSnapshot 引用不同会触发无限重渲染
  // (生产环境即 React error #185)。取原始数组引用,派生放渲染体(同 BackgroundTasks 先例)。
  const backgroundTasks = useAgentStore((s) => s.backgroundTasks);
  const runningTasks = backgroundTasks.filter((t) => t.status === "running");
  const run = useWorkflowStore((s) => s.run);
  const { projectPath } = useUIStore();

  // Workflow execution: variable input
  const [execWorkflow, setExecWorkflow] = useState<Workflow | null>(null);
  const [varValues, setVarValues] = useState<Record<string, string>>({});

  useEffect(() => {
    loadWorkflows(projectPath);
  }, [projectPath, loadWorkflows]);

  const allAgents = [
    { name: "(主会话)", value: "" },
    ...projectAgents.map((a) => ({ name: a.name, value: a.name })),
    ...userAgents.map((a) => ({ name: a.name, value: a.name })),
  ];

  const handleExecute = (wf: Workflow) => {
    if (wf.variables.length > 0) {
      // Has variables — show inline form to fill them
      const initial: Record<string, string> = {};
      wf.variables.forEach((v) => { initial[v] = ""; });
      setVarValues(initial);
      setExecWorkflow(wf);
    } else {
      // No variables — execute directly
      composeAndSend(wf, {});
    }
  };

  const confirmExecute = () => {
    if (!execWorkflow) return;
    composeAndSend(execWorkflow, varValues);
    setExecWorkflow(null);
    setVarValues({});
  };

  /**
   * 真正启动编排。
   *
   * 此前这里是把步骤拼成一段提示词塞进输入框（setPrefillInput）—— 不调度、
   * 不等待、不传数据，界面却用方框加箭头暗示流水线。现在交给服务端的编排
   * 引擎：它按步执行、每步等上一步真的结束、把产出经变量喂给下一步。
   *
   * 引擎参数走 buildEngineParams()，与手动发消息完全同源；少带字段会让常驻
   * 进程指纹对不上、白白杀进程重启。
   */
  const composeAndSend = (wf: Workflow, vars: Record<string, string>) => {
    wsService.send("workflow_start", {
      workflowId: wf.id,
      inputs: vars,
      engineParams: buildEngineParams(),
    });
  };

  // ── Editor view ──
  if (editing) {
    return (
      <WorkflowEditor
        workflow={editing}
        agents={allAgents}
        onSave={async (wf) => {
          await saveWorkflow(wf, projectPath);
        }}
        onCancel={() => setEditing(null)}
      />
    );
  }

  // ── Variable input form for execution ──
  if (execWorkflow) {
    return (
      <div className="p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Play size={13} className="text-emerald-ok" />
            <span className="text-xs font-medium text-slate-200">
              执行：{execWorkflow.name}
            </span>
          </div>
          <button onClick={() => setExecWorkflow(null)}
            className="p-1 rounded hover:bg-white/5 text-slate-400">
            <X size={13} />
          </button>
        </div>

        <p className="text-[10px] text-slate-400">
          请填写工作流变量，然后点击"开始执行"
        </p>

        <div className="space-y-2">
          {execWorkflow.variables.map((v) => (
            <div key={v}>
              <label className="text-[10px] text-slate-500 mb-1 block">
                ${v}
              </label>
              <input
                value={varValues[v] || ""}
                onChange={(e) => setVarValues({ ...varValues, [v]: e.target.value })}
                placeholder={`输入 $${v} 的值`}
                className="w-full text-xs bg-white/5 border border-white/10 rounded-md px-2.5 py-1.5 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-glow/30"
              />
            </div>
          ))}
        </div>

        {/* Step preview */}
        <div className="rounded-lg border border-white/8 bg-white/[0.02] p-2">
          <div className="text-[10px] text-slate-500 mb-1.5">执行步骤预览</div>
          {execWorkflow.steps.map((step, i) => {
            let prompt = step.prompt;
            for (const [k, val] of Object.entries(varValues)) {
              prompt = prompt.replaceAll(`$${k}`, val || `\${${k}}`);
            }
            return (
              <div key={i} className="flex items-start gap-2 mb-1.5 last:mb-0">
                <span className="text-[9px] text-amber-glow font-mono flex-shrink-0 mt-0.5">
                  {i + 1}.
                </span>
                <div className="text-[10px] text-slate-300 leading-relaxed">
                  <span className="text-violet-info">[{step.agent || "主会话"}]</span>{" "}
                  {prompt.length > 80 ? prompt.slice(0, 80) + "..." : prompt}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex gap-2 pt-1">
          <button onClick={() => setExecWorkflow(null)}
            className="text-xs px-3 py-1.5 text-slate-300 hover:text-white transition-colors">
            取消
          </button>
          <button onClick={confirmExecute}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-emerald-ok/15 text-emerald-ok hover:bg-emerald-ok/25 border border-emerald-ok/20 transition-colors">
            <Play size={12} /> 开始执行
          </button>
        </div>
      </div>
    );
  }

  // ── List view ──
  return (
    <div className="p-3 space-y-3">
      {/* 这里显示的是**后台任务**(SDK 的 task_started / background_tasks_changed 事件),
          与工作流编排是两类对象:编排的进度在下方 RunPanel,数据来自 workflow_state。
          原先标题只写「运行中」、右侧又显示 agentName,一眼看去像是某个工作流在跑。 */}
      {runningTasks.length > 0 && (
        <div className="rounded-lg border border-emerald-ok/20 bg-emerald-ok/5 p-2.5 space-y-1.5">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-ok">
            <Loader2 size={11} className="animate-spin" />
            后台任务运行中（{runningTasks.length}）
          </div>
          {runningTasks.map((t) => (
            <div key={t.id} className="flex items-center gap-2 text-[11px]">
              <Bot size={11} className="text-emerald-ok/70 flex-shrink-0" />
              <span className="text-slate-300 truncate flex-1" title={t.description}>
                {t.description}
              </span>
              <span className="text-[10px] font-mono text-slate-500 flex-shrink-0">
                {t.agentName}
              </span>
            </div>
          ))}
          <p className="text-[10px] text-slate-500">
            详情见「后台任务」标签页，事件流见「审计」
          </p>
        </div>
      )}

      {run && <RunPanel run={run} />}

      <button onClick={createNew}
        className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md bg-amber-glow/10 text-amber-glow hover:bg-amber-glow/20 border border-amber-glow/20 transition-colors">
        <Plus size={12} /> 新建工作流
      </button>

      {loading ? (
        <div className="flex justify-center py-4">
          <Loader2 size={16} className="animate-spin text-slate-400" />
        </div>
      ) : workflows.length === 0 ? (
        <div className="text-center py-4">
          <GitMerge size={20} className="mx-auto text-slate-500 mb-2" />
          <p className="text-xs text-slate-400">暂无工作流</p>
          {/* Phase 13 起这句话是真的了:服务端编排引擎按步执行、每步等上一步
              真的结束、把产出经变量喂给下一步。改这里前先确认行为仍然如此。 */}
          <p className="text-[10px] text-slate-500 mt-1">
            创建工作流，按步骤依次执行并在步骤间传递结果
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {workflows.map((wf) => (
            <div key={wf.id}
              className="p-2.5 rounded-lg border border-white/8 bg-white/[0.02]">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <GitMerge size={13} className="text-violet-info" />
                  <span className="text-xs font-medium text-slate-200">{wf.name}</span>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => handleExecute(wf)}
                    className="p-1 rounded hover:bg-emerald-ok/10 text-slate-400 hover:text-emerald-ok transition-colors"
                    title="执行工作流（按步骤依次运行）">
                    <Play size={11} />
                  </button>
                  <button onClick={() => setEditing(wf)}
                    className="p-1 rounded hover:bg-white/5 text-slate-400 hover:text-slate-200 transition-colors">
                    <Pencil size={11} />
                  </button>
                  <button onClick={() => deleteWorkflow(wf.id, projectPath)}
                    className="p-1 rounded hover:bg-white/5 text-slate-400 hover:text-rose-err transition-colors">
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>

              {/* Step visualization */}
              <div className="flex items-center gap-1 overflow-x-auto pb-1">
                {wf.steps.map((step, i) => (
                  <div key={i} className="flex items-center flex-shrink-0">
                    <div className="px-2 py-1 rounded bg-white/5 border border-white/10">
                      <div className="text-[9px] text-slate-200 font-medium">
                        {step.agent || "主会话"}
                      </div>
                    </div>
                    {i < wf.steps.length - 1 && (
                      <ArrowRight size={10} className="text-slate-500 mx-0.5" />
                    )}
                  </div>
                ))}
              </div>

              {wf.variables.length > 0 && (
                <div className="text-[9px] text-slate-400 mt-1">
                  变量: {wf.variables.map((v) => `$${v}`).join(", ")}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WorkflowEditor({
  workflow, agents, onSave, onCancel,
}: {
  workflow: Workflow;
  agents: { name: string; value: string }[];
  onSave: (wf: Workflow) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(workflow.name);
  const [steps, setSteps] = useState<WorkflowStep[]>(workflow.steps);

  // 变量归类与校验都基于当前编辑中的内容实时算。
  // 规则与服务端保存时用的是同一套（client/src/utils/workflowValidate.ts
  // 与 server/.../workflow/validate.ts 保持同步），前端这份只为即时提示，
  // 真正的闸门在服务端 —— 请求可以绕过界面直接发。
  const outputVars = steps
    .map((s) => s.outputVar?.trim())
    .filter((v): v is string => !!v);
  const inputVars = [
    ...new Set(steps.flatMap((s) => extractReferencedVars(s.prompt ?? ""))),
  ].filter((v) => !outputVars.includes(v));
  const issues = validateWorkflowDraft({ name, steps, variables: inputVars });

  const updateStep = (index: number, updates: Partial<WorkflowStep>) => {
    setSteps((prev) =>
      prev.map((s, i) => (i === index ? { ...s, ...updates } : s))
    );
  };

  const addStep = () => {
    setSteps([...steps, { agent: null, prompt: "" }]);
  };

  const removeStep = (index: number) => {
    if (steps.length <= 1) return;
    setSteps(steps.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    if (!name) return;
    await onSave({ ...workflow, name, steps });
  };

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-200">
          {workflow.id ? "编辑工作流" : "新建工作流"}
        </span>
        <button onClick={onCancel} className="p-1 rounded hover:bg-white/5 text-slate-400">
          <X size={13} />
        </button>
      </div>

      <input value={name} onChange={(e) => setName(e.target.value)}
        placeholder="工作流名称"
        className="w-full text-xs bg-white/5 border border-white/10 rounded-md px-2.5 py-1.5 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-glow/30" />

      {/* Steps */}
      <div className="space-y-2">
        {steps.map((step, i) => (
          <div key={i} className="p-2.5 rounded-lg border border-white/8 bg-white/[0.02]">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] text-slate-300 font-medium">
                步骤 {i + 1}
              </span>
              {steps.length > 1 && (
                <button onClick={() => removeStep(i)}
                  className="p-0.5 text-slate-400 hover:text-rose-err">
                  <X size={10} />
                </button>
              )}
            </div>
            <select
              value={step.agent || ""}
              onChange={(e) => updateStep(i, { agent: e.target.value || null })}
              className="w-full text-xs bg-white/5 border border-white/10 rounded-md px-2 py-1.5 text-slate-200 mb-1.5"
            >
              {agents.map((a) => (
                <option key={a.value} value={a.value}>{a.name}</option>
              ))}
            </select>
            <textarea
              value={step.prompt}
              onChange={(e) => updateStep(i, { prompt: e.target.value })}
              rows={2}
              placeholder="提示词（可用 $变量 引用前面步骤的产出）"
              className="w-full text-xs font-mono bg-white/5 border border-white/10 rounded-md px-2 py-1.5 text-slate-200 placeholder-slate-500 resize-none focus:outline-none focus:border-amber-glow/30"
            />

            {/* 编排配置：不填也能用，保持简单场景零配置 */}
            <div className="flex gap-1.5 mt-1.5">
              <input
                value={step.outputVar ?? ""}
                onChange={(e) => updateStep(i, { outputVar: e.target.value.trim() || undefined })}
                placeholder="产出存为变量（选填）"
                title="填了之后，后面的步骤可以用 $名称 引用这一步的结果"
                className="flex-1 min-w-0 text-[10px] font-mono bg-white/5 border border-white/10 rounded px-2 py-1 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-amber-glow/30"
              />
              <select
                value={step.onFailure ?? "ask"}
                onChange={(e) =>
                  updateStep(i, {
                    onFailure: e.target.value === "ask" ? undefined : (e.target.value as WorkflowStep["onFailure"]),
                  })
                }
                title="这一步失败时怎么办"
                className="text-[10px] bg-white/5 border border-white/10 rounded px-1.5 py-1 text-slate-300 focus:outline-none"
              >
                <option value="ask">失败时询问</option>
                <option value="retry">失败自动重试</option>
                <option value="skip">失败自动跳过</option>
                <option value="abort">失败即中止</option>
              </select>
            </div>
          </div>
        ))}
      </div>

      {/* 校验提示：结构上跑不通的问题就地指出，别等运行到一半才发现 */}
      {issues.length > 0 && (
        <div className="rounded-md border border-rose-err/25 bg-rose-err/5 p-2 space-y-0.5">
          {issues.map((it, k) => (
            <p key={k} className="text-[10px] text-rose-err">
              {it.message}
            </p>
          ))}
        </div>
      )}

      {/* 变量总览：区分「运行前要填的」和「步骤产出的」，避免混淆 */}
      {(inputVars.length > 0 || outputVars.length > 0) && (
        <div className="rounded-md border border-white/8 bg-white/[0.02] p-2 space-y-1">
          {inputVars.length > 0 && (
            <p className="text-[10px] text-slate-400">
              运行前需填写：
              {inputVars.map((v) => (
                <span key={v} className="font-mono text-amber-glow ml-1">${v}</span>
              ))}
            </p>
          )}
          {outputVars.length > 0 && (
            <p className="text-[10px] text-slate-400">
              步骤产出：
              {outputVars.map((v) => (
                <span key={v} className="font-mono text-emerald-ok ml-1">${v}</span>
              ))}
            </p>
          )}
        </div>
      )}

      <button onClick={addStep}
        className="flex items-center gap-1.5 text-[11px] text-slate-300 hover:text-amber-glow transition-colors">
        <Plus size={11} /> 添加步骤
      </button>

      <div className="flex gap-2 pt-1">
        <button onClick={onCancel} className="text-xs px-3 py-1.5 text-slate-300">取消</button>
        <button onClick={handleSave}
          disabled={issues.length > 0}
          title={issues.length > 0 ? "请先修正上方问题" : undefined}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-amber-glow/10 text-amber-glow hover:bg-amber-glow/20 border border-amber-glow/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-amber-glow/10">
          <Save size={12} /> 保存
        </button>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════
   运行态面板
   ════════════════════════════════════════════ */

const STEP_STYLE: Record<string, { label: string; cls: string }> = {
  pending: { label: "等待", cls: "text-slate-500 border-white/10" },
  running: { label: "运行中", cls: "text-amber-glow border-amber-glow/30 bg-amber-glow/5" },
  succeeded: { label: "完成", cls: "text-emerald-ok border-emerald-ok/25 bg-emerald-ok/5" },
  failed: { label: "失败", cls: "text-rose-err border-rose-err/30 bg-rose-err/5" },
  skipped: { label: "已跳过", cls: "text-slate-400 border-white/10" },
  aborted: { label: "已中止", cls: "text-slate-500 border-white/10" },
};

function fmtSpan(from?: number, to?: number): string {
  if (!from) return "";
  const ms = (to ?? Date.now()) - from;
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/**
 * 工作流运行态。
 *
 * 整份状态由服务端推送，这里只做展示与回传指令 —— 前端不自行推进步骤，
 * 否则断线重连后会与服务端的真实进度打架。
 */
function RunPanel({ run }: { run: WorkflowRunState }) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const done = run.status === "completed" || run.status === "aborted";
  const failedStep = run.status === "awaiting" ? run.steps.find((s) => s.status === "failed") : null;

  return (
    <div className="rounded-lg border border-violet-info/25 bg-violet-info/[0.04] p-2.5 space-y-2">
      <div className="flex items-center gap-1.5">
        {run.status === "running" ? (
          <Loader2 size={11} className="animate-spin text-violet-info" />
        ) : (
          <GitMerge size={11} className="text-violet-info" />
        )}
        <span className="text-[11px] font-medium text-slate-200 truncate flex-1">
          {run.workflowName}
        </span>
        <span className="text-[10px] text-slate-400">
          {done ? (run.status === "completed" ? "已完成" : "已中止") : `第 ${run.currentStep + 1} / ${run.steps.length} 步`}
        </span>
        {!done && (
          <button
            onClick={() => wsService.send("workflow_abort", {})}
            title="停止整个工作流"
            className="p-1 rounded hover:bg-rose-err/10 text-slate-400 hover:text-rose-err transition-colors"
          >
            <X size={11} />
          </button>
        )}
      </div>

      {/* 步骤列表 */}
      <div className="space-y-1">
        {run.steps.map((s) => {
          const style = STEP_STYLE[s.status] ?? STEP_STYLE.pending;
          const body = s.output || s.error;
          return (
            <div key={s.index} className={`rounded border px-2 py-1.5 ${style.cls}`}>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-mono text-slate-500 w-4">{s.index + 1}</span>
                <span className="text-[10px] font-medium flex-1">{style.label}</span>
                {s.attempts > 1 && (
                  <span className="text-[9px] text-slate-500">第 {s.attempts} 次</span>
                )}
                {s.startedAt && (
                  <span className="text-[9px] font-mono text-slate-500">
                    {fmtSpan(s.startedAt, s.finishedAt)}
                  </span>
                )}
                {body && (
                  <button
                    onClick={() => setExpanded(expanded === s.index ? null : s.index)}
                    className="text-[9px] text-slate-400 hover:text-slate-200 transition-colors"
                  >
                    {expanded === s.index ? "收起" : "查看"}
                  </button>
                )}
              </div>
              {expanded === s.index && body && (
                <pre className="mt-1 text-[10px] text-slate-300 whitespace-pre-wrap break-words max-h-40 overflow-y-auto font-mono">
                  {body}
                </pre>
              )}
            </div>
          );
        })}
      </div>

      {/* 失败处置 —— 引擎停在这一步等指令，不选就不会继续 */}
      {failedStep && (
        <div className="rounded border border-rose-err/30 bg-rose-err/5 p-2 space-y-1.5">
          <p className="text-[10px] text-rose-err">
            第 {failedStep.index + 1} 步失败：{failedStep.error || "未知原因"}
          </p>
          <div className="flex gap-1.5">
            {([
              ["retry", "重试这一步"],
              ["skip", "跳过继续"],
              ["abort", "中止工作流"],
            ] as const).map(([action, label]) => (
              <button
                key={action}
                onClick={() => wsService.send("workflow_resolve", { resolution: action })}
                className="flex-1 text-[10px] py-1 rounded border border-white/10 text-slate-300 hover:bg-white/5 hover:text-white transition-colors"
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {done && run.message && <p className="text-[10px] text-slate-400">{run.message}</p>}
      {done && (
        <button
          onClick={() => useWorkflowStore.getState().setRun(null)}
          className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
        >
          关闭结果
        </button>
      )}
    </div>
  );
}
