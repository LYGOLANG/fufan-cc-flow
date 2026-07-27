import assert from "node:assert/strict";
import test from "node:test";
import type { IncomingMessage } from "node:http";
import { isAuthEnabled, isAuthorizedUpgrade } from "./auth.js";

/**
 * 鉴权是「谁能调这套接口」的边界。它有两个必须同时成立的性质:
 *   1. 设了令牌就必须真的拦(否则等于没做)
 *   2. 没设令牌就必须整体放行(否则 pnpm dev 直接瘫痪)
 * 第 2 条同样重要 —— 这类开关最常见的事故是「上线时忘了配,应用起不来」,
 * 或者反过来「本地能跑,打包后全是 401」。
 */

const TOKEN = "unit-test-token";

/** 造一个最小的 upgrade 请求对象 */
function upgradeReq(url: string, headers: Record<string, string> = {}): IncomingMessage {
  return { url, headers } as unknown as IncomingMessage;
}

function withToken<T>(value: string | undefined, fn: () => T): T {
  const prev = process.env.CC_FLOW_AUTH_TOKEN;
  if (value === undefined) delete process.env.CC_FLOW_AUTH_TOKEN;
  else process.env.CC_FLOW_AUTH_TOKEN = value;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.CC_FLOW_AUTH_TOKEN;
    else process.env.CC_FLOW_AUTH_TOKEN = prev;
  }
}

test("未配置令牌时鉴权整体关闭 —— pnpm dev 必须照常可用", () => {
  withToken(undefined, () => {
    assert.equal(isAuthEnabled(), false);
    assert.equal(isAuthorizedUpgrade(upgradeReq("/ws/chat?project=x")), true);
  });
});

test("空白令牌等同于未配置(避免把空串当成有效凭据)", () => {
  withToken("   ", () => {
    assert.equal(isAuthEnabled(), false);
    assert.equal(isAuthorizedUpgrade(upgradeReq("/ws/chat")), true);
  });
});

test("配置令牌后,WS 升级必须携带正确令牌", () => {
  withToken(TOKEN, () => {
    assert.equal(isAuthEnabled(), true);
    assert.equal(isAuthorizedUpgrade(upgradeReq(`/ws/chat?token=${TOKEN}`)), true);
  });
});

test("WS 无令牌 / 错令牌一律拒绝", () => {
  withToken(TOKEN, () => {
    assert.equal(isAuthorizedUpgrade(upgradeReq("/ws/chat?project=x")), false);
    assert.equal(isAuthorizedUpgrade(upgradeReq("/ws/chat?token=wrong")), false);
    assert.equal(isAuthorizedUpgrade(upgradeReq(`/ws/chat?token=${TOKEN}x`)), false);
    // 前缀正确但被截断,也必须拒绝(定长比较不能退化成前缀比较)
    assert.equal(isAuthorizedUpgrade(upgradeReq(`/ws/chat?token=${TOKEN.slice(0, -1)}`)), false);
  });
});

test("令牌也可经请求头携带(REST 走这条路)", () => {
  withToken(TOKEN, () => {
    assert.equal(isAuthorizedUpgrade(upgradeReq("/ws/chat", { "x-cc-flow-token": TOKEN })), true);
    assert.equal(
      isAuthorizedUpgrade(upgradeReq("/ws/chat", { authorization: `Bearer ${TOKEN}` })),
      true
    );
    assert.equal(
      isAuthorizedUpgrade(upgradeReq("/ws/chat", { authorization: "Bearer nope" })),
      false
    );
  });
});

test("token 里的特殊字符经 URL 解码后仍能正确匹配", () => {
  const weird = "a+b/c=d";
  withToken(weird, () => {
    assert.equal(
      isAuthorizedUpgrade(upgradeReq(`/ws/chat?token=${encodeURIComponent(weird)}`)),
      true
    );
  });
});
