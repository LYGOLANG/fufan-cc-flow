#!/usr/bin/env bash
#
# Agent Flow - remote backend installer
#
# Installs the Node backend on a remote machine so the desktop client can
# reach it through an SSH tunnel.
#
# Usage:
#   bash install-remote.sh <source-dir> [target-dir]
#
#   source-dir  directory holding the backend build: dist/ + package.json
#   target-dir  install location (default: $HOME/.agent-flow-server)
#
# Output is intentionally ASCII-only: remote shells frequently run under the
# C/POSIX locale, where non-ASCII turns into mojibake and obscures real errors.
#
# NOTE ON NATIVE MODULES
#   node-pty ships prebuilt binaries for darwin and win32 ONLY - there is no
#   linux prebuild in the npm package. It therefore must be compiled here,
#   which is why python3 / make / a C++ compiler are hard requirements.
#   Copying a Windows or macOS node_modules across will NOT work.

set -euo pipefail

SRC="${1:-}"
DST="${2:-$HOME/.agent-flow-server}"

die() { echo "ERROR: $*" >&2; exit 1; }
ok()  { echo "  [ok] $*"; }

[ -n "$SRC" ] || die "missing source directory. Usage: bash install-remote.sh <source-dir> [target-dir]"
[ -d "$SRC" ] || die "source directory not found: $SRC"
[ -d "$SRC/dist" ] || die "source has no dist/ directory: $SRC"
[ -f "$SRC/package.json" ] || die "source has no package.json: $SRC"

echo "=== 1/5 checking prerequisites ==="

command -v node >/dev/null || die "node not found. Install Node.js 18 or newer."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 18 ] || die "node $(node -v) is too old; need 18 or newer."
ok "node $(node -v)"

command -v npm >/dev/null || die "npm not found."
ok "npm $(npm -v)"

# Required to build node-pty. Missing these produces a node-gyp failure deep in
# npm's output that is easy to misread as a network problem.
MISSING=""
command -v python3 >/dev/null || MISSING="$MISSING python3"
command -v make >/dev/null || MISSING="$MISSING make"
{ command -v g++ >/dev/null || command -v c++ >/dev/null || command -v clang++ >/dev/null; } || MISSING="$MISSING a C++ compiler (g++/clang++)"
if [ -n "$MISSING" ]; then
  echo "  missing build tools:$MISSING" >&2
  echo "  Debian/Ubuntu: sudo apt-get install -y python3 build-essential" >&2
  echo "  RHEL/Fedora:   sudo dnf install -y python3 gcc-c++ make" >&2
  echo "  Alpine:        sudo apk add python3 build-base" >&2
  die "install the build tools above, then re-run."
fi
ok "build toolchain present"

# The backend is only a shell around the Claude Code CLI; without it the server
# starts fine but every conversation fails. Warn rather than abort so the tunnel
# can still be smoke-tested.
if command -v claude >/dev/null; then
  ok "claude CLI $(claude --version 2>&1 | head -1)"
else
  echo "  [warn] claude CLI not found on this machine."
  echo "         The backend will start, but conversations will fail until it is"
  echo "         installed AND logged in as the user running the backend."
fi

echo "=== 2/5 installing files into $DST ==="
mkdir -p "$DST"
rm -rf "$DST/dist"
cp -r "$SRC/dist" "$DST/dist"
cp "$SRC/package.json" "$DST/package.json"
ok "copied dist/ and package.json"

echo "=== 3/5 installing production dependencies ==="
cd "$DST"
# Deliberately NOT copying node_modules from the source machine - see the note
# about node-pty at the top of this file.
NPM_ARGS="--omit=dev --no-audit --no-fund"
if [ -n "${AGENT_FLOW_NPM_REGISTRY:-}" ]; then
  NPM_ARGS="$NPM_ARGS --registry=$AGENT_FLOW_NPM_REGISTRY"
fi

# node-gyp downloads Node headers from `disturl`, which is a SEPARATE setting
# from the npm registry. On networks where nodejs.org is slow or blocked, the
# package download succeeds at full speed and then the build hangs until
# ETIMEDOUT - the error names node-gyp, not the network, so it reads like a
# toolchain problem. Probe first and fall back to a mirror.
if [ -z "${npm_config_disturl:-}" ]; then
  echo "  probing nodejs.org for build headers..."
  if curl -fsS --connect-timeout 8 --max-time 15 -o /dev/null \
       "https://nodejs.org/download/release/v$(node -p 'process.versions.node')/" 2>/dev/null; then
    ok "nodejs.org reachable"
  else
    export npm_config_disturl="${AGENT_FLOW_NODE_MIRROR:-https://cdn.npmmirror.com/binaries/node}"
    echo "  [warn] nodejs.org unreachable; using header mirror:"
    echo "         $npm_config_disturl"
    echo "         Override with AGENT_FLOW_NODE_MIRROR if you have your own."
  fi
fi

# shellcheck disable=SC2086
if ! npm install $NPM_ARGS; then
  echo "" >&2
  echo "npm install failed. If the output above mentions node-gyp and a failed" >&2
  echo "download of node-*-headers.tar.gz, it is a network issue, not a compiler" >&2
  echo "issue. Retry with an explicit header mirror:" >&2
  echo "  AGENT_FLOW_NODE_MIRROR=https://cdn.npmmirror.com/binaries/node bash install-remote.sh ..." >&2
  die "dependency installation failed."
fi

echo "=== 4/5 verifying native module ==="
PTY_BIN="$(find node_modules/node-pty -name 'pty.node' -not -path '*prebuilds*' 2>/dev/null | head -1 || true)"
if [ -z "$PTY_BIN" ]; then
  PTY_BIN="$(find node_modules/node-pty -name '*.node' 2>/dev/null | head -1 || true)"
fi
[ -n "$PTY_BIN" ] || die "node-pty built no native binary; the terminal feature would fail. Check the npm output above."
ok "node-pty binary: $PTY_BIN"

node -e 'import("node-pty").then(()=>console.log("  [ok] node-pty loads")).catch(e=>{console.error("  node-pty failed to load:",e.message);process.exit(1)})'

echo "=== 5/5 done ==="
cat <<EOF

Installed at: $DST

The desktop client starts this automatically over SSH. To verify by hand:

  CC_FLOW_AUTH_TOKEN=<token> PORT=3001 node $DST/dist/index.js

The server binds 127.0.0.1 by default, which is exactly what an SSH tunnel
needs - do not set HOST=0.0.0.0 unless you intend to expose it directly.

From the client machine, forward the port with:

  ssh -N -L 9999:127.0.0.1:3001 <user>@<this-host>

then point the client at http://localhost:9999 using the same token.
EOF
