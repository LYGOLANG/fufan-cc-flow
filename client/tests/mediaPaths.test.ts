import assert from "node:assert/strict";
import test from "node:test";
import { extractMediaPaths, mediaKindOf } from "../src/utils/mediaPaths";

/**
 * 这条正则里既有中文字符范围、又有 Windows 反斜杠，改动时极易被转义吃掉一层。
 * 失效方式是**静默的**：识别不到任何路径，界面什么都不显示，也不报错。
 * 所以这里把每种路径形态都钉死。
 */

test("认得 Windows 绝对路径（反斜杠）", () => {
  // 注意这里必须写 \\ —— 少一层的话 JS 会把 \U \m \o \d 当成无意义转义
  // 直接吞掉反斜杠，测的就不再是「Windows 路径」了（lint 会报 no-useless-escape）
  const got = extractMediaPaths("视频已导出到 C:\\Users\\me\\out\\demo.mp4");
  assert.deepEqual(got, ["C:\\Users\\me\\out\\demo.mp4"]);
});

test("认得 Unix 路径", () => {
  assert.deepEqual(extractMediaPaths("生成完成：/home/u/videos/clip.webm"), [
    "/home/u/videos/clip.webm",
  ]);
});

test("认得中文文件名与相对路径", () => {
  assert.deepEqual(extractMediaPaths("图片保存在 ./assets/图-1.png"), ["./assets/图-1.png"]);
});

test("视频与音频都能认出来（此前只认图片）", () => {
  for (const [text, want] of [
    ["产物 out/final.mp4 已就绪", "out/final.mp4"],
    ["配音 voice.mp3 完成", "voice.mp3"],
    ["录屏 rec.mov", "rec.mov"],
    ["音轨 track.flac", "track.flac"],
  ] as const) {
    assert.deepEqual(extractMediaPaths(text), [want], text);
  }
});

test("远程 URL 不进内联预览（交给标签直接加载）", () => {
  assert.deepEqual(extractMediaPaths("见 https://x.com/a.mp4"), []);
});

test("已被 markdown 渲染的路径不重复显示", () => {
  const exclude = new Set(["a.png"]);
  assert.deepEqual(extractMediaPaths("![](a.png) 另有 b.mp4", exclude), ["b.mp4"]);
});

test("去重，且受数量上限约束", () => {
  const text = "a.png a.png b.mp4 c.mp3 d.wav e.gif f.mov g.webm";
  const got = extractMediaPaths(text, undefined, 3);
  assert.equal(got.length, 3);
  assert.equal(new Set(got).size, 3);
});

test("多次调用互不干扰（正则 lastIndex 不共享）", () => {
  const text = "x.mp4";
  // 共享 lastIndex 的写法会让隔次调用漏匹配 —— 表现为「有时能预览有时不能」
  assert.deepEqual(extractMediaPaths(text), ["x.mp4"]);
  assert.deepEqual(extractMediaPaths(text), ["x.mp4"]);
  assert.deepEqual(extractMediaPaths(text), ["x.mp4"]);
});

test("mediaKindOf 分类正确", () => {
  assert.equal(mediaKindOf("a.png"), "image");
  assert.equal(mediaKindOf("a.MP4"), "video");
  assert.equal(mediaKindOf("a.mp3"), "audio");
  assert.equal(mediaKindOf("a.txt"), null);
  assert.equal(mediaKindOf("noext"), null);
});

test("带查询串的 URL 也能判类型", () => {
  assert.equal(mediaKindOf("http://h/v.mp4?t=1"), "video");
  assert.equal(mediaKindOf("/p/a.png#frag"), "image");
});

/**
 * 媒体 URL 必须带鉴权令牌。
 *
 * <img> / <video> 的请求由浏览器直接发出，**带不了自定义请求头**，所以
 * 桌面版开着鉴权时只能把令牌放进 query。少了这一步的后果极其隐蔽：
 * 后端返回 401 → onError 触发 → 组件静默隐藏 → 界面上什么都没有、
 * 也不报错，看起来就像"这功能压根没做"。实际就这么坑了一整轮。
 */
test("媒体 URL 构造必须经过 withAuthQuery", async () => {
  const { readFileSync } = await import("node:fs");
  for (const f of [
    "src/components/shared/MediaPreview.tsx",
    "src/components/shared/MarkdownRenderer.tsx",
  ]) {
    const src = readFileSync(f, "utf8");
    // 找出所有真正构造 /files/raw 地址的行。
    // 注释形式有三种（// 、/** 、*），都要排除 —— 只看真正拼 URL 的那行，
    // 判据是它得有模板字符串反引号。
    const lines = src.split("\n").filter((l) => {
      if (!l.includes("files/raw")) return false;
      const t = l.trimStart();
      if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return false;
      return l.includes("`");
    });
    assert.ok(lines.length > 0, `${f} 里没有 /files/raw 的构造点？`);
    for (const l of lines) {
      assert.ok(
        l.includes("withAuthQuery"),
        `${f} 构造媒体地址时漏了 withAuthQuery，桌面版会 401 且静默隐藏：\n${l.trim()}`
      );
    }
  }
});
