import { useEffect, useRef, useState } from "react";

/**
 * Live2D 渲染层。
 *
 * **这个文件必须始终以 lazy() 引入**，因为它会把 PixiJS 8 + Cubism 运行时
 * 拉进 chunk（数百 KB）。不开看板娘的用户不该为它下载任何字节 ——
 * CompanionAvatar 里的动态 import 就是那道闸，别改成静态 import。
 *
 * 两个外部依赖不在 npm 里，必须由用户自己放到位（见 modelPath 的说明）：
 *   live2dcubismcore.min.js —— 从 Live2D 官方 Cubism SDK for Web 里取，
 *     它是专有运行时，不能随包分发。缺它时模型加载会失败，这里给出明确提示
 *     而不是静默显示空白。
 *   模型文件 —— .model3.json 及其引用的 moc3、贴图、动作。
 *
 * 授权：个人及年营收 1000 万日元以下的小规模使用免费，超过需要向 Live2D
 * 申请 Publication License。这个软件自用，落在免费档内。
 */

interface Props {
  /** 模型入口文件的可访问 URL（.model3.json） */
  modelUrl: string;
  /** 画布边长，正方形 */
  size?: number;
  /** 加载失败时回调，交给外层决定退回什么 */
  onError?: (msg: string) => void;
}

/** Cubism Core 是否已注入全局。它由 <script> 引入，不走模块系统。 */
function hasCubismCore(): boolean {
  return typeof (window as unknown as { Live2DCubismCore?: unknown }).Live2DCubismCore !== "undefined";
}

export default function Live2DStage({ modelUrl, size = 220, onError }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    // 清理函数在两个阶段都可能被赋值，先占位免得早退时漏收
    let cleanup: (() => void) | undefined;

    void (async () => {
      if (!hasCubismCore()) {
        const msg =
          "缺少 Live2D 运行时（live2dcubismcore.min.js）。它是 Live2D 官方的专有文件，" +
          "不能随应用分发，需要你从 Cubism SDK for Web 里取出后放到模型目录旁。";
        setErr(msg);
        onError?.(msg);
        return;
      }

      try {
        // 动态 import：这两个包很大，只有真正要渲染时才拉
        const [{ Application, Ticker }, live2d] = await Promise.all([
          import("pixi.js"),
          import("@jannchie/pixi-live2d-display"),
        ]);
        if (disposed || !hostRef.current) return;

        // 插件需要拿到 Ticker 才能驱动模型的自动动作（呼吸、眨眼、物理）
        live2d.Live2DModel.registerTicker(Ticker);

        const app = new Application();
        await app.init({
          width: size,
          height: size,
          backgroundAlpha: 0,
          antialias: true,
          // 跟随系统缩放，否则高 DPI 屏上模型发虚
          resolution: window.devicePixelRatio || 1,
          autoDensity: true,
        });
        if (disposed) {
          app.destroy(true);
          return;
        }
        hostRef.current.appendChild(app.canvas);

        const model = await live2d.Live2DModel.from(modelUrl);
        if (disposed) {
          app.destroy(true);
          return;
        }

        // 等比缩放到画布内，并居中。模型原始尺寸差异很大，写死缩放必然有的
        // 模型撑爆、有的缩成一点。
        const scale = Math.min(size / model.width, size / model.height);
        model.scale.set(scale);
        model.x = (size - model.width * scale) / 2;
        model.y = (size - model.height * scale) / 2;
        app.stage.addChild(model);

        cleanup = () => {
          try {
            app.destroy(true, { children: true });
          } catch {
            /* 已销毁 */
          }
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setErr(`模型加载失败：${msg}`);
        onError?.(msg);
      }
    })();

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [modelUrl, size, onError]);

  if (err) {
    return (
      <div
        className="rounded-xl border border-rose-err/30 bg-rose-err/5 p-3 text-[10px] text-slate-300 leading-relaxed"
        style={{ width: size }}
      >
        {err}
      </div>
    );
  }

  return <div ref={hostRef} style={{ width: size, height: size }} />;
}
