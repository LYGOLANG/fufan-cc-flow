import { useConfigStore } from "../stores/configStore";
import { useUIStore } from "../stores/uiStore";

/**
 * 发送 send_message 时必须携带的「引擎参数」公共字段。
 *
 * 为什么要收口成一个函数:这组字段原先在 4 个调用点各手抄一遍
 * (InputBar 的正常发送与 slash 分支、ContextBar 的手动压缩、
 * handoffRunner 的会话交接),抄漏是必然的,而且漏了不报错、只是行为变差:
 *
 * 后端 claudeAgentService.spawnFingerprint 会把 effort / thinkingBudget /
 * maxBudget 等一起算进「常驻进程指纹」。某个调用点少带一个字段,指纹就与
 * 主对话不一致,SDK 会判定需要换进程 —— 杀掉常驻进程重启,连带杀掉正在跑的
 * 后台 sub-agent。InputBar 的 slash 分支里那条「缺一不可」的注释就是为此补的,
 * 但同样的漏在压缩路径上仍然存在(两处都没带 thinkingBudget)。
 *
 * 以后新增引擎相关字段,只改这里一处。
 */
export interface EngineParams {
  model: string;
  effort: string;
  runMode: string;
  engine: string;
  codexModel: string;
  codexEffort: string;
  providerId: string;
  apiKey?: string;
  /** 扩展思考开关。只在关闭时传 false —— 见下方注释 */
  thinking?: false;
  thinkingBudget?: number;
  maxBudget?: number;
}

export function buildEngineParams(): EngineParams {
  const cfg = useConfigStore.getState();
  const { runMode } = useUIStore.getState();

  return {
    model: cfg.model,
    effort: cfg.effort,
    runMode,
    engine: cfg.engine,
    codexModel: cfg.codexModel,
    codexEffort: cfg.codexEffort,
    providerId: cfg.providerId,
    apiKey: cfg.apiKey || undefined,
    // 扩展思考关闭时显式传 false,让后端注入 thinking:{type:"disabled"}。
    // 此前只传 budget,于是「关掉开关」和「开着但用自适应」的 payload 完全相同,
    // 拨到关模型照样思考 —— 那个开关实际只是预算档位的显示开关。
    // 只在关闭时传:开启是默认态,不传可兼容旧后端。
    thinking: cfg.thinking ? undefined : false,
    // 仅在开启扩展思考且选了具体档位时注入(0 = 交给 SDK 自适应)
    thinkingBudget: cfg.thinking && cfg.thinkingBudget > 0 ? cfg.thinkingBudget : undefined,
    // 单次任务费用上限;0 = 不限制
    maxBudget: cfg.maxBudget > 0 ? cfg.maxBudget : undefined,
  };
}
