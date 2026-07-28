import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeJsonlContent } from "./jsonlSanitize.js";

/**
 * 会话 JSONL 净化的测试。
 *
 * 这段逻辑会改写**用户真实的聊天记录文件**。出错的后果是历史被写坏且无法
 * 回退，所以这里的用例偏执一些：畸形 JSON、空行、超长内容、各种 id 形态
 * 都要保证「要么正确改，要么原样不动」，绝不能丢内容。
 */

const asst = (id: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ type: "assistant", message: { id, content: "hi" }, ...extra });

test("第三方端点的裸 id 补上 msg_ 前缀", () => {
  const r = sanitizeJsonlContent(asst("abc123"));
  assert.equal(r.changed, 1);
  assert.equal(JSON.parse(r.content).message.id, "msg_abc123");
});

test("已有 msg_ 前缀的不重复添加", () => {
  const line = asst("msg_already");
  const r = sanitizeJsonlContent(line);
  assert.equal(r.changed, 0);
  assert.equal(r.content, line, "没改动时应原样返回");
});

test("只动 assistant 行，user/system 行不碰", () => {
  const user = JSON.stringify({ type: "user", message: { id: "u1" } });
  const system = JSON.stringify({ type: "system", subtype: "init", message: { id: "s1" } });
  const r = sanitizeJsonlContent([user, system].join("\n"));
  assert.equal(r.changed, 0);
  assert.equal(r.content, [user, system].join("\n"));
});

test("多行混排：只改该改的，其余逐字保留", () => {
  const user = JSON.stringify({ type: "user", message: { id: "u1" } });
  const raw = [user, asst("x1"), user, asst("msg_ok"), asst("x2")].join("\n");
  const r = sanitizeJsonlContent(raw);
  assert.equal(r.changed, 2);
  const out = r.content.split("\n");
  assert.equal(out.length, 5, "行数不能变");
  assert.equal(out[0], user);
  assert.equal(JSON.parse(out[1]).message.id, "msg_x1");
  assert.equal(out[3], asst("msg_ok"), "已合规的行应逐字不变");
  assert.equal(JSON.parse(out[4]).message.id, "msg_x2");
});

test("回归：非法 JSON 行原样保留，绝不丢弃", () => {
  // 这是用户的聊天记录。宁可让 CLI 自己去处理一行坏数据，
  // 也不能因为解析失败就把它抹掉。
  const broken = '{"type":"assistant","message":{"id":"x"';  // 截断的 JSON
  const r = sanitizeJsonlContent([broken, asst("y1")].join("\n"));
  assert.equal(r.changed, 1);
  const out = r.content.split("\n");
  assert.equal(out[0], broken, "坏行必须原样留着");
  assert.equal(JSON.parse(out[1]).message.id, "msg_y1");
});

test("空输入与空行不报错、不丢行", () => {
  assert.deepEqual(sanitizeJsonlContent(""), { content: "", changed: 0 });
  const withBlank = [asst("a"), "", asst("b"), ""].join("\n");
  const r = sanitizeJsonlContent(withBlank);
  assert.equal(r.changed, 2);
  assert.equal(r.content.split("\n").length, 4, "空行必须保留（尾部空行影响追加写入）");
});

test("尾随换行被保留", () => {
  // JSONL 通常以换行结尾，丢了它下次追加会与最后一行粘连
  const r = sanitizeJsonlContent(asst("a") + "\n");
  assert.ok(r.content.endsWith("\n"), "尾随换行不能丢");
});

test("id 缺失 / 非字符串 / 空串：一律不动", () => {
  const cases = [
    JSON.stringify({ type: "assistant", message: { content: "no id" } }),
    JSON.stringify({ type: "assistant", message: { id: 123 } }),
    JSON.stringify({ type: "assistant", message: { id: "" } }),
    JSON.stringify({ type: "assistant" }),
  ];
  for (const line of cases) {
    const r = sanitizeJsonlContent(line);
    assert.equal(r.changed, 0, `不该改动: ${line}`);
    assert.equal(r.content, line);
  }
});

test("字符串里恰好含 assistant 但 type 不是 assistant：不动", () => {
  // 快速跳过用的是 includes('"assistant"')，可能命中正文内容
  const line = JSON.stringify({ type: "user", message: { id: "u", content: '说到 "assistant" 时' } });
  const r = sanitizeJsonlContent(line);
  assert.equal(r.changed, 0);
  assert.equal(r.content, line);
});

test("记录里的其它字段在改写后完整保留", () => {
  // 改写走的是 JSON.parse → 改 id → JSON.stringify，字段丢失会静默损坏历史
  const line = asst("x", { uuid: "u-1", timestamp: "2026-07-28T00:00:00Z", parentUuid: "p-1" });
  const r = sanitizeJsonlContent(line);
  const rec = JSON.parse(r.content);
  assert.equal(rec.message.id, "msg_x");
  assert.equal(rec.uuid, "u-1");
  assert.equal(rec.timestamp, "2026-07-28T00:00:00Z");
  assert.equal(rec.parentUuid, "p-1");
  assert.equal(rec.message.content, "hi");
});
