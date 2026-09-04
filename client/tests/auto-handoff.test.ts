import assert from "node:assert/strict";
import test from "node:test";
import {
  decideAutoHandoff,
  extractHandoffDoc,
  buildHandoffRequestPrompt,
  buildHandoffOpeningPrompt,
  MIN_HANDOFF_DOC_CHARS,
  type AutoHandoffInput,
} from "../src/utils/autoHandoff";

const MAX = 200_000;

/** 默认:阈值 90%、已武装、刚聊完一轮 */
function input(over: Partial<AutoHandoffInput> = {}): AutoHandoffInput {
  return {
    contextTokens: 0,
    contextMax: MAX,
    threshold: 90,
    armed: true,
    justFinishedStreaming: true,
    ...over,
  };
}

/** 按百分比换算 token,让用例读起来就是「用量百分之几」 */
const at = (pct: number) => Math.round((pct / 100) * MAX);

// ── 触发时机 ───────────────────────────────────────────────

test("聊完一轮后用量越过阈值 -> 交接", () => {
  const d = decideAutoHandoff(input({ contextTokens: at(91) }));
  assert.equal(d.action, "handoff");
});

test("阈值 100 表示关闭,再满也不交接", () => {
  const d = decideAutoHandoff(input({ contextTokens: at(99.9), threshold: 100 }));
  assert.equal(d.action, "none");
});

test("用量未到阈值 -> 不交接", () => {
  const d = decideAutoHandoff(input({ contextTokens: at(89) }));
  assert.equal(d.action, "none");
});

test("回归:打开一个本来就快满的旧会话,不能自动交接", () => {
  // 切换会话/开机恢复会话时 chatStore.loadHistoryMessages 会把 contextTokens
  // 直接设成该历史会话的用量,此时并没有「刚聊完一轮」。
  // 判错的代价比压缩时代更大:会直接把用户正看着的会话换掉。
  const d = decideAutoHandoff(input({ contextTokens: at(98), justFinishedStreaming: false }));
  assert.equal(d.action, "none");
});

test("已解除武装时不重复交接(防止贴着阈值反复触发)", () => {
  const d = decideAutoHandoff(input({ contextTokens: at(95), armed: false }));
  assert.equal(d.action, "none");
});

test("交接进行中时不再触发第二次", () => {
  // 「写交接文档」那一轮结束时用量必然还在阈值之上,不挡住就会套娃
  const d = decideAutoHandoff(input({ contextTokens: at(93), inProgress: true }));
  assert.equal(d.action, "none");
});

test("交接后用量掉到回差以下 -> 重新武装", () => {
  const d = decideAutoHandoff(input({ contextTokens: at(30), armed: false }));
  assert.equal(d.action, "rearm");
});

test("回差区间内(阈值下方但不足 5 个百分点)不重新武装", () => {
  // 阈值 90、回差 5 => 只有低于 85% 才重新武装
  const d = decideAutoHandoff(input({ contextTokens: at(87), armed: false }));
  assert.equal(d.action, "none");
});

test("回落判断不依赖「刚结束流式」——切到低用量会话也应重新武装", () => {
  const d = decideAutoHandoff(
    input({ contextTokens: at(10), armed: false, justFinishedStreaming: false })
  );
  assert.equal(d.action, "rearm");
});

test("上下文用量为 0 或窗口未知时不做任何决策", () => {
  assert.equal(decideAutoHandoff(input({ contextTokens: 0 })).action, "none");
  assert.equal(decideAutoHandoff(input({ contextTokens: at(96), contextMax: 0 })).action, "none");
});

test("交接决策带回真实百分比,用于文案与分隔符", () => {
  const d = decideAutoHandoff(input({ contextTokens: at(91) }));
  assert.equal(d.action, "handoff");
  if (d.action === "handoff") assert.ok(Math.abs(d.pct - 91) < 0.5);
});

test("1M 窗口下按比例判断,而非绝对 token 数", () => {
  // 91 万 / 100 万 = 91% > 90% -> 交接;同样的 91 万在 200K 窗口早就超了,
  // 说明判断必须走比例,这条锁住换模型后阈值语义不变。
  const d = decideAutoHandoff(
    input({ contextTokens: 910_000, contextMax: 1_000_000 })
  );
  assert.equal(d.action, "handoff");
  const low = decideAutoHandoff(
    input({ contextTokens: 500_000, contextMax: 1_000_000 })
  );
  assert.equal(low.action, "rearm");
});

// ── 交接文档的提取 ─────────────────────────────────────────

const longDoc = [
  "1. 当前任务:把上下文满时的自动压缩换成「交接到新会话」,阈值 90%。",
  "2. 已完成:decideAutoHandoff 决策函数与 handoffRunner 执行器,typecheck 与 lint 均通过。",
  "3. 下一步:补文档同步,再打包验证一次真实链路。",
  "4. 关键文件:client/src/utils/autoHandoff.ts:1、client/src/utils/handoffRunner.ts:1。",
  "5. 死路:别把文档写成文件,需要工具权限,在询问权限模式下会卡住整条交接。",
].join("\n");

test("取的是交接请求之后那一轮的助手回复", () => {
  const msgs = [
    { role: "user", content: "之前的问题" },
    { role: "assistant", content: "之前那轮的回复" + "，它绝对不能被当成交接文档使用".repeat(5) },
    { role: "user", content: "【Agent Flow 自动交接】..." },
    { role: "assistant", content: longDoc },
  ];
  assert.equal(extractHandoffDoc(msgs, 3), longDoc);
});

test("回归:这一轮没有助手回复时返回 null,不许拿上一轮的顶包", () => {
  // 被中止/报错时就是这个形状。返回旧回复的话,接班人会拿到一份
  // 与当前工作无关的交接 —— 比没有更糟。
  const msgs = [
    { role: "assistant", content: "上一轮跟交接毫无关系的长回复" + "，不能被误用为文档".repeat(8) },
    { role: "user", content: "【Agent Flow 自动交接】..." },
  ];
  assert.equal(extractHandoffDoc(msgs, 2), null);
});

test("助手只回了一句敷衍的短话或一句拒绝 -> 不算文档", () => {
  // 拿这种回复当交接开新会话 = 整段上下文当场蒸发,所以门槛宁高勿低
  const refusal = "好的,我明白了,不过我现在没有足够的信息来写这份交接文档。";
  const msgs = [
    { role: "user", content: "【Agent Flow 自动交接】..." },
    { role: "assistant", content: refusal },
  ];
  assert.equal(extractHandoffDoc(msgs, 1), null);
  assert.ok(refusal.length < MIN_HANDOFF_DOC_CHARS);
  assert.ok(longDoc.length >= MIN_HANDOFF_DOC_CHARS);
});

test("一轮里有多条助手消息时取最后一条(工具调用后才写的正文)", () => {
  const first = "我先看一下当前的状态" + "，这条只是过程说明不是最终文档".repeat(6);
  const msgs = [
    { role: "user", content: "【Agent Flow 自动交接】..." },
    { role: "assistant", content: first },
    { role: "assistant", content: longDoc },
  ];
  assert.equal(extractHandoffDoc(msgs, 1), longDoc);
});

test("空内容的助手消息被跳过", () => {
  const msgs = [
    { role: "user", content: "【Agent Flow 自动交接】..." },
    { role: "assistant", content: longDoc },
    { role: "assistant", content: "" },
  ];
  assert.equal(extractHandoffDoc(msgs, 1), longDoc);
});

// ── 文案 ───────────────────────────────────────────────────

test("交接请求明确禁止调工具与写文件", () => {
  // 这不是文风问题:模型若去写 HANDOFF.md,就等于替用户改了他的工作目录,
  // 而且在需要权限确认的运行模式下会卡住整条交接。
  const p = buildHandoffRequestPrompt(91);
  assert.match(p, /不要调用任何工具/);
  assert.match(p, /不要写文件/);
  assert.match(p, /91%/);
});

test("开场白包住文档全文,并要求从「下一步」接着干", () => {
  const p = buildHandoffOpeningPrompt(longDoc, 91);
  assert.ok(p.includes(longDoc));
  assert.match(p, /交接文档开始/);
  assert.match(p, /交接文档结束/);
  assert.match(p, /下一步/);
});
