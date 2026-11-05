#!/bin/zsh
# 盯表任务(默认每 3 分钟):本机跑一轮 watch-tick(不花 AI 钱);
# 只有出现新回信 / 中文修改意见要翻译时才叫 Claude,且最多每 claudeCooldownMinutes 分钟一次。
# 用法: watch.sh <活动文件夹>
set -u
CAMPAIGN_DIR="${1:?用法: watch.sh <活动文件夹>}"
SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$CAMPAIGN_DIR" || exit 1
mkdir -p reports
LOG="reports/watch-$(date +%F).log"

# 同一时间只跑一个(上一轮还没完就跳过)
LOCK="reports/.watch.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +20 2>/dev/null)" ]; then rmdir "$LOCK"; mkdir "$LOCK"; else exit 0; fi
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

echo "── $(date '+%F %T')" >> "$LOG"
node "$SKILL_DIR/cp.js" watch-tick >> "$LOG" 2>&1
CODE=$?
[ $CODE -ne 10 ] && exit 0

COOLDOWN=$(node -e "try{console.log(JSON.parse(require('fs').readFileSync('pipeline.config.json','utf8')).claudeCooldownMinutes??15)}catch{console.log(15)}")
STAMP="reports/.last-claude"
if [ -f "$STAMP" ] && [ -z "$(find "$STAMP" -mmin +"$COOLDOWN" 2>/dev/null)" ]; then
  echo "有事要 Claude 处理,冷却中(每 $COOLDOWN 分钟最多一次)" >> "$LOG"; exit 0
fi
touch "$STAMP"
PROMPT="$(sed "s|{{SKILL_DIR}}|$SKILL_DIR|g" "$SKILL_DIR/schedule/watch-prompt.md")"
echo "叫 Claude 处理回信/翻译" >> "$LOG"
claude -p "$PROMPT" \
  --allowedTools \
    "Bash(node:*)" "Read" \
    "mcp__claude_ai_Gmail__search_threads" "mcp__claude_ai_Gmail__get_thread" "mcp__claude_ai_Gmail__get_message" \
  >> "$LOG" 2>&1
