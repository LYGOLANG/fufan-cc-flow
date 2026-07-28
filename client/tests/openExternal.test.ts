import assert from "node:assert/strict";
import test from "node:test";
import { parseLocalhostUrl } from "../src/utils/openExternal";

/**
 * AI 回复里「打开 http://localhost:3000 预览」这类链接的识别。
 *
 * 这段正则识别对不对,直接决定远程模式下点开的到底是远程机器上真正在跑的
 * 服务,还是本机自己那个恰好同号、大概率什么都没有的端口。
 */

test("识别 localhost 与 127.0.0.1，端口缺省按协议补全", () => {
  assert.deepEqual(parseLocalhostUrl("http://localhost:3000"), {
    scheme: "http://",
    port: 3000,
    rest: "",
  });
  assert.deepEqual(parseLocalhostUrl("http://127.0.0.1:8080/app"), {
    scheme: "http://",
    port: 8080,
    rest: "/app",
  });
  // 没写端口:http 补 80,https 补 443 —— 而不是当成"无端口=不用转发"
  assert.equal(parseLocalhostUrl("http://localhost")?.port, 80);
  assert.equal(parseLocalhostUrl("https://localhost")?.port, 443);
});

test("大小写不敏感（LOCALHOST、Localhost 都要认得出）", () => {
  assert.ok(parseLocalhostUrl("http://LOCALHOST:5173"));
  assert.ok(parseLocalhostUrl("http://Localhost:5173"));
});

test("外部网址不匹配，原样放行", () => {
  assert.equal(parseLocalhostUrl("https://github.com"), null);
  assert.equal(parseLocalhostUrl("https://example.com:3000"), null);
  // 域名里含 localhost 但不是它本身，不能误伤
  assert.equal(parseLocalhostUrl("https://notlocalhost.com"), null);
});

test("非 http(s) 协议不匹配", () => {
  assert.equal(parseLocalhostUrl("ftp://localhost:21"), null);
  assert.equal(parseLocalhostUrl("mailto:a@b.com"), null);
});

test("路径与查询串原样保留", () => {
  const r = parseLocalhostUrl("http://localhost:3000/api/health?x=1#frag");
  assert.equal(r?.rest, "/api/health?x=1#frag");
});
