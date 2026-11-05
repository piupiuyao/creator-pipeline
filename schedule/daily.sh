#!/bin/zsh
# 每日任务:在活动文件夹里无人值守跑一遍日常流程。用法: daily.sh <活动文件夹>
# 只授权"读 Gmail + 建草稿 + 读 Drive + 跑引擎",不授权发信工具 —— 机器永远发不出邮件。
set -u
CAMPAIGN_DIR="${1:?用法: daily.sh <活动文件夹>}"
export SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$CAMPAIGN_DIR" || exit 1
mkdir -p reports
TODAY=$(date +%F)

# 把技能目录的绝对路径写进提示词(权限规则按字面匹配命令,不认 $变量)
PROMPT="$(sed "s|{{SKILL_DIR}}|$SKILL_DIR|g" "$SKILL_DIR/schedule/daily-prompt.md")"
claude -p "$PROMPT" \
  --allowedTools \
    "Bash(node:*)" "Bash(base64:*)" "Read" "Write" \
    "mcp__claude_ai_Gmail__search_threads" "mcp__claude_ai_Gmail__get_thread" \
    "mcp__claude_ai_Gmail__get_message" "mcp__claude_ai_Gmail__list_drafts" \
    "mcp__claude_ai_Gmail__get_draft" "mcp__claude_ai_Gmail__create_draft" \
    "mcp__claude_ai_Google_Drive__download_file_content" \
  >> "reports/run-$TODAY.log" 2>&1
STATUS=$?

# 桌面通知(macOS)
if command -v osascript >/dev/null; then
  if [ $STATUS -eq 0 ] && [ -f "reports/$TODAY.md" ]; then
    LINE=$(grep -m1 '^## 需要你做的' "reports/$TODAY.md" | sed 's/^## //')
    osascript -e "display notification \"$LINE\" with title \"达人外联日报 $TODAY\""
  else
    osascript -e "display notification \"今天的自动运行出错了,看 reports/run-$TODAY.log\" with title \"达人外联日报\""
  fi
fi
exit $STATUS
