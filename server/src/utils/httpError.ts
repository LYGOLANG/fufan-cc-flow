/**
 * 校验类错误的统一表示。
 *
 * 路径守卫(assertSafeName / assertWithinRoot)和入参校验抛出的错误都带
 * `statusCode`,路由层据此回 400/403 而不是笼统的 500 —— 前端能据此给出
 * 「名称不合法」这类可操作的提示,而不是「服务器错误」。
 */
export interface HttpError extends Error {
  statusCode: number;
}

export function httpError(status: number, message: string): HttpError {
  return Object.assign(new Error(message), { statusCode: status });
}

/** 取错误的 HTTP 状态码;非校验类错误一律 500 */
export function statusOf(err: unknown): number {
  const code = (err as { statusCode?: unknown })?.statusCode;
  return typeof code === "number" && code >= 400 && code < 600 ? code : 500;
}

/**
 * 面向用户的错误文案。
 *
 * 校验类错误(4xx)的 message 是我们自己写的、可以安全展示;500 类可能含
 * 内部路径或堆栈,只回一句通用提示,细节留在服务端日志里。
 */
export function messageOf(err: unknown, fallback = "操作失败"): string {
  return statusOf(err) === 500 ? fallback : ((err as Error)?.message ?? fallback);
}
