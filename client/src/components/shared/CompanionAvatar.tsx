import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useChatStore } from "../../stores/chatStore";
import { useUIStore } from "../../stores/uiStore";

/**
 * Live2D 渲染层必须 lazy —— 它会拉进 PixiJS 8 + Cubism 运行时（数百 KB）。
 * 改成静态 import 的话，不用看板娘的人也要下载这些字节。
 * 只有配置了模型路径时才会走到这里。
 */
const Live2DStage = lazy(() => import("./Live2DStage"));

/**
 * 界面角落里的伴随角色。
 *
 * 为什么不直接上 Live2D：
 *   pixi-live2d-display 最后更新停在 2023-12，且锁死 PixiJS 6.x（当前 8.x）；
 *   官方 CubismWebFramework 不在 npm，要 vendor 源码，Core 还得单独下载。
 *   两条路都会往项目里长期塞一个上一代图形栈，而"界面上有个活物会反应"
 *   这件事本身不需要它。
 *
 * 所以这里只做**状态驱动的表现层**，渲染后端是可换的：
 * 现在用 CSS + SVG 零依赖实现，将来要接 Live2D 时，替换 renderFace 即可，
 * 状态机、触发时机、开关这些都不用动。
 *
 * 状态取自真实事件，不做假动作：
 *   idle     没任务
 *   thinking 流式进行中
 *   waiting  有待确认的权限（这个最急，60 秒不点就自动拒绝）
 *   done     刚结束，短暂庆祝后回 idle
 */

type Mood = "idle" | "thinking" | "waiting" | "done";

const FACE: Record<Mood, { eye: string; mouth: string; hint: string }> = {
  idle: { eye: "M 8 13 q 3 -3 6 0 M 20 13 q 3 -3 6 0", mouth: "M 14 22 q 3 2 6 0", hint: "" },
  thinking: { eye: "M 8 12 h 6 M 20 12 h 6", mouth: "M 15 22 h 4", hint: "思考中" },
  waiting: { eye: "M 8 11 q 3 4 6 0 M 20 11 q 3 4 6 0", mouth: "M 14 23 q 3 -3 6 0", hint: "等你确认" },
  done: { eye: "M 8 14 q 3 -5 6 0 M 20 14 q 3 -5 6 0", mouth: "M 13 21 q 4 5 8 0", hint: "完成了" },
};

/** done 状态停留多久后回到 idle */
const DONE_LINGER_MS = 4000;

export default function CompanionAvatar() {
  const isStreaming = useChatStore((s) => s.isStreaming);
  const pendingPermCount = useChatStore((s) => s.pendingPermissions.size);
  const companionEnabled = useUIStore((s) => s.companionEnabled);
  const setCompanionEnabled = useUIStore((s) => s.setCompanionEnabled);
  const companionModelUrl = useUIStore((s) => s.companionModelUrl);
  const setCompanionModelUrl = useUIStore((s) => s.setCompanionModelUrl);

  const [mood, setMood] = useState<Mood>("idle");
  const [blink, setBlink] = useState(false);
  const doneTimer = useRef<number | undefined>(undefined);
  const wasStreaming = useRef(false);

  // ── 状态推导 ──
  useEffect(() => {
    if (pendingPermCount > 0) {
      setMood("waiting");
      return;
    }
    if (isStreaming) {
      wasStreaming.current = true;
      setMood("thinking");
      return;
    }
    // 从流式转为空闲 = 这一轮刚结束，短暂庆祝
    if (wasStreaming.current) {
      wasStreaming.current = false;
      setMood("done");
      window.clearTimeout(doneTimer.current);
      doneTimer.current = window.setTimeout(() => setMood("idle"), DONE_LINGER_MS);
      return;
    }
    setMood("idle");
  }, [isStreaming, pendingPermCount]);

  useEffect(() => () => window.clearTimeout(doneTimer.current), []);

  // ── 眨眼 ──
  // 间隔随机，固定节奏会显得像机器在打拍子
  useEffect(() => {
    if (!companionEnabled) return;
    let timer: number;
    const schedule = () => {
      timer = window.setTimeout(
        () => {
          setBlink(true);
          window.setTimeout(() => setBlink(false), 120);
          schedule();
        },
        2500 + Math.random() * 3500,
      );
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, [companionEnabled]);

  if (!companionEnabled) return null;

  const face = FACE[mood];
  const tone =
    mood === "waiting" ? "#d97757" : mood === "done" ? "#10b981" : "#7c3aed";

  return (
    <div
      className="fixed bottom-4 right-4 z-40 select-none"
      // 不抢占鼠标：整块只有角色本体可点，避免挡住右下角的界面
      style={{ pointerEvents: "none" }}
    >
      {face.hint && (
        <div
          className="mb-1.5 px-2 py-1 rounded-lg text-[10px] text-slate-300 text-center"
          style={{ background: "rgba(19,17,28,0.9)", border: "1px solid rgba(255,255,255,0.08)" }}
        >
          {face.hint}
        </div>
      )}
      {/* 配了模型就用 Live2D。加载失败时清空配置退回 SVG ——
          与其让用户对着一块空白，不如退到一定能显示的东西。 */}
      {companionModelUrl && (
        <div style={{ pointerEvents: "auto" }}>
          <Suspense fallback={null}>
            <Live2DStage
              modelUrl={companionModelUrl}
              size={220}
              onError={() => setCompanionModelUrl("")}
            />
          </Suspense>
        </div>
      )}

      {!companionModelUrl && (
      <button
        onClick={() => setCompanionEnabled(false)}
        title="点击隐藏（可在设置里重新打开）"
        className="block transition-transform hover:scale-105 active:scale-95"
        style={{ pointerEvents: "auto" }}
      >
        <svg
          width="56"
          height="56"
          viewBox="0 0 34 34"
          className={mood === "thinking" ? "animate-pulse" : ""}
        >
          <circle
            cx="17"
            cy="17"
            r="15"
            fill="rgba(19,17,28,0.92)"
            stroke={tone}
            strokeWidth="1.5"
          />
          <g stroke={tone} strokeWidth="1.6" strokeLinecap="round" fill="none">
            {blink ? (
              <path d="M 8 12 h 6 M 20 12 h 6" />
            ) : (
              <path d={face.eye} />
            )}
            <path d={face.mouth} />
          </g>
        </svg>
      </button>
      )}
    </div>
  );
}
