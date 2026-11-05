#!/bin/zsh
# 装每日定时任务(macOS)。用法: install-mac.sh <活动文件夹> [小时,默认10] [分钟,默认0]
# 卸载: launchctl unload ~/Library/LaunchAgents/com.creator-pipeline.<名字>.plist && rm 那个文件
set -eu
DIR="$(cd "${1:?用法: install-mac.sh <活动文件夹> [小时] [分钟]}" && pwd)"
HOUR="${2:-10}"; MIN="${3:-0}"
SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NAME="$(basename "$DIR" | tr -c 'A-Za-z0-9\n' '-' | tr 'A-Z' 'a-z')"
LABEL="com.creator-pipeline.$NAME"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
chmod +x "$SKILL_DIR/schedule/daily.sh"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>/bin/zsh</string><string>-lc</string><string>"$SKILL_DIR/schedule/daily.sh" "$DIR"</string></array>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>$HOUR</integer><key>Minute</key><integer>$MIN</integer></dict>
  <key>StandardOutPath</key><string>$DIR/reports/launchd.out</string>
  <key>StandardErrorPath</key><string>$DIR/reports/launchd.err</string>
</dict>
</plist>
EOF
mkdir -p "$DIR/reports"
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "已安装:每天 $HOUR:$(printf %02d $MIN) 在 $DIR 跑一次(电脑需开机且已登录)。"
echo "手动试跑:\"$SKILL_DIR/schedule/daily.sh\" \"$DIR\""
