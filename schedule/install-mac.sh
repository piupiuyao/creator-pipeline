#!/bin/zsh
# 装定时任务(macOS)。用法: install-mac.sh <活动文件夹> [日报小时,默认10] [分钟,默认0] [盯表间隔秒,默认180]
#   · 日报:每天固定时间跑一遍完整流程 + 出日报
#   · 盯表:配了表桥(sheetBridgeUrl)才装,每隔几分钟执行表里的决定、起草、回写进度
# 卸载: launchctl unload ~/Library/LaunchAgents/com.creator-pipeline.<名字>.*.plist && rm 那些文件
set -eu
DIR="$(cd "${1:?用法: install-mac.sh <活动文件夹> [小时] [分钟] [盯表间隔秒]}" && pwd)"
HOUR="${2:-10}"; MIN="${3:-0}"; EVERY="${4:-180}"
SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NAME="$(basename "$DIR" | tr -c 'A-Za-z0-9\n' '-' | tr 'A-Z' 'a-z')"
chmod +x "$SKILL_DIR/schedule/"*.sh
mkdir -p "$DIR/reports"

install_plist() { # label script schedule-xml
  local PLIST="$HOME/Library/LaunchAgents/$1.plist"
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$1</string>
  <key>ProgramArguments</key>
  <array><string>/bin/zsh</string><string>-lc</string><string>"$SKILL_DIR/schedule/$2" "$DIR"</string></array>
  $3
  <key>StandardOutPath</key><string>$DIR/reports/launchd.out</string>
  <key>StandardErrorPath</key><string>$DIR/reports/launchd.err</string>
</dict>
</plist>
EOF
  launchctl unload "$PLIST" 2>/dev/null || true
  launchctl load "$PLIST"
}

install_plist "com.creator-pipeline.$NAME.daily" daily.sh \
  "<key>StartCalendarInterval</key><dict><key>Hour</key><integer>$HOUR</integer><key>Minute</key><integer>$MIN</integer></dict>"
echo "已装日报:每天 $HOUR:$(printf %02d $MIN)。"

if node -e "process.exit(JSON.parse(require('fs').readFileSync('$DIR/pipeline.config.json','utf8')).sheetBridgeUrl?0:1)" 2>/dev/null; then
  install_plist "com.creator-pipeline.$NAME.watch" watch.sh "<key>StartInterval</key><integer>$EVERY</integer>"
  echo "已装盯表:每 $EVERY 秒执行一次表里的决定、起草、回写进度。"
else
  echo "没配表桥(sheetBridgeUrl),没装盯表。配好后重新运行本脚本即可。"
fi
echo "电脑需开机且已登录。手动试跑:\"$SKILL_DIR/schedule/watch.sh\" \"$DIR\""
