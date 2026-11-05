# The daily run

Once set up, the pipeline runs itself every morning (default 10:00): it syncs
what the human sent, reads replies, drafts everything that is due, and writes
a report. The human's whole job is: open Gmail drafts, review, send; answer
the "等你拍板" items.

## Set it up (macOS)

1. Confirm `claude` works in the user's terminal and the Gmail connector is
   connected (the scheduled run uses the same login).
2. Optional, for sheet pulls: add `"googleSheetId": "<id from the sheet URL>"`
   and `"googleSheetTab": "<tab>"` to pipeline.config.json.
3. Run once by hand to approve permissions and see a full run:
   `"<skill_dir>/schedule/daily.sh" "<campaign folder>"`
4. Install: `"<skill_dir>/schedule/install-mac.sh" "<campaign folder>" 10 0`

The Mac must be on and logged in at that time. If it was asleep, launchd runs
the job when it wakes.

## Windows

Task Scheduler → Create Basic Task → Daily 10:00 → Start a program:
`claude` with arguments
`-p "<contents of schedule/daily-prompt.md>" --allowedTools ...` (same list as
daily.sh) and "Start in" = the campaign folder. Set environment variable
`SKILL_DIR` to the skill folder.

## What the scheduled run may and may not do

It is granted: running the engine, reading/creating files in the campaign
folder, reading Gmail, creating Gmail drafts, downloading the sheet. It is NOT
granted any send tool, so it cannot email a creator even by mistake. It does
not lock prices, pass reviews, record payments, or spend money on sourcing.
Pushing to the Google Sheet needs Chrome and happens in the next interactive
session (ask the user "要不要把表同步到 Google Sheet?").

## Where the report goes

- `reports/<date>.md` in the campaign folder (always)
- a macOS notification with the "需要你做的" count
- a Gmail draft to `reportEmail` with subject `[日报] 达人外联 <date>`, if set
