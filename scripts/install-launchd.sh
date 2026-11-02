#!/bin/bash
# Mac 登录后自动启动 PowerFedora50，并在崩溃时自动重启。
#   安装：bash scripts/install-launchd.sh
#   卸载：bash scripts/install-launchd.sh remove
set -euo pipefail

LABEL="com.powerfedora50.server"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DIR="$(cd "$(dirname "$0")/.." && pwd)"

if [ "$(uname)" != "Darwin" ]; then echo "这个脚本只适用于 macOS"; exit 1; fi

if [ "${1:-}" = "remove" ]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "已卸载"
  exit 0
fi

NODE="$(command -v node || true)"
if [ -z "$NODE" ]; then echo "没有找到 node，请先安装 Node 20 以上"; exit 1; fi

mkdir -p "$HOME/Library/LaunchAgents" "$DIR/data"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$DIR/server.js</string></array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$DIR/data/server.log</string>
  <key>StandardErrorPath</key><string>$DIR/data/server.log</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "已安装并启动：http://127.0.0.1:5050    日志：$DIR/data/server.log"
