#!/bin/bash
# 用本机 Chrome 无头截一页。
# 用法：screenshot.sh <网址或 html 路径> <输出.png> [宽 高]，宽高默认 1440 900。
# Chrome 常常写完图不退出，所以文件一出现就把它杀掉。
# 无头 Chrome 最窄只到 500，宽度给小了它照 500 排版再裁图；手机宽度用自带浏览器工具的设备模拟看。
URL="$1"; OUT="$2"; W="${3:-1440}"; H="${4:-900}"
if [ -z "$URL" ] || [ -z "$OUT" ]; then echo "用法：screenshot.sh <网址或 html 路径> <输出.png> [宽 高]" >&2; exit 1; fi
case "$URL" in http*|file*) ;; *) URL="file://$(cd "$(dirname "$URL")" && pwd)/$(basename "$URL")" ;; esac
CHROME=""
for c in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" "$(command -v google-chrome 2>/dev/null)" "$(command -v chromium 2>/dev/null)" "$(command -v chrome 2>/dev/null)"; do
  if [ -n "$c" ] && [ -x "$c" ]; then CHROME="$c"; break; fi
done
if [ -z "$CHROME" ]; then echo "没找到 Chrome" >&2; exit 1; fi
PROFILE="$(mktemp -d)"
rm -f "$OUT"
"$CHROME" --headless=new --disable-gpu --hide-scrollbars --no-first-run --no-default-browser-check \
  --user-data-dir="$PROFILE" --window-size="$W,$H" --virtual-time-budget=4000 --screenshot="$OUT" "$URL" >/dev/null 2>&1 &
PID=$!
for i in $(seq 1 80); do if [ -s "$OUT" ]; then break; fi; sleep 0.5; done
sleep 1; kill "$PID" 2>/dev/null; wait "$PID" 2>/dev/null
rm -rf "$PROFILE"
if [ -s "$OUT" ]; then echo "已截图：${OUT}（${W}×${H}）"; else echo "40 秒没截出来" >&2; exit 1; fi
