/**
 * resume 前的会话 JSONL 净化 —— 纯逻辑部分。
 *
 * 为什么需要净化：第三方兼容端点写进历史的 assistant 消息 id 不带 `msg_`
 * 前缀，而官方 API 在 resume 时会拒收（400）。补上前缀即可继续用同一段历史。
 *
 * 为什么把它与文件读写分开：这个函数会**改写用户真实的聊天记录文件**，
 * 逻辑出错就是历史被写坏、且无法回退。分离之后可以拿各种畸形输入猛测，
 * 不用碰任何真实文件。
 */

export interface SanitizeResult {
  /** 净化后的整份内容；未改动时与输入完全相同 */
  content: string;
  /** 被补前缀的 assistant 消息条数 */
  changed: number;
}

export function sanitizeJsonlContent(raw: string): SanitizeResult {
  let changed = 0;
  const lines = raw.split("\n").map((line) => {
    // 快速跳过非 assistant 行：会话 JSONL 里绝大多数是 user/system/工具结果
    if (!line.includes('"assistant"')) return line;
    try {
      const rec = JSON.parse(line) as { type?: string; message?: { id?: unknown } };
      const msg = rec?.message;
      if (
        rec?.type === "assistant" &&
        typeof msg?.id === "string" &&
        msg.id &&
        !msg.id.startsWith("msg_")
      ) {
        msg.id = `msg_${msg.id}`;
        changed++;
        return JSON.stringify(rec);
      }
    } catch {
      // 非法 JSON 行原样保留。
      // 绝不能丢弃或"修复"它 —— 这是用户的聊天记录，宁可让 CLI 自己去处理
      // 一行坏数据，也不能因为解析失败就把它抹掉。
    }
    return line;
  });
  return { content: lines.join("\n"), changed };
}
