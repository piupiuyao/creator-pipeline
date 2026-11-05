# Sheet bridge: make the Google Sheet the control panel

With the bridge, the team works in the Google Sheet like in the platform:
write a decision in the 「你的决定」 column, and within a few minutes the
email is drafted in Gmail; after a human sends it in Gmail, the row moves to
its next step on its own. No browser automation, no waiting for the daily run.

How it works: a small Apps Script (`sheet/bridge.gs`) lives inside the team
sheet. The local watcher (`schedule/watch.sh`, every 3 minutes) calls it to
read/write the tab, create Gmail drafts, and check whether drafts were sent or
creators replied. Claude is only woken when an email must be read.

## One-time setup (about 5 minutes, done by the sheet owner)

Walk the user through these; they must click the Google permission screens
themselves.

1. Open the team sheet → **Extensions → Apps Script**.
2. Delete the sample code, paste the whole of `sheet/bridge.gs`, save.
3. Left sidebar **Services (+)** → add **Gmail API** (identifier `Gmail`).
4. Select the function `setup` → **Run** → approve the permission screens
   (Sheets + Gmail, on the user's own account). Open **Execution log**: copy
   the `sheetBridgeToken = ...` value.
5. **Deploy → New deployment** → type **Web app**; Execute as: **Me**; Who has
   access: **Anyone**. Deploy and copy the **Web app URL**.
6. In the campaign's `pipeline.config.json` set:
   ```json
   "googleSheetId": "<id from the sheet URL>",
   "googleSheetTab": "<a tab only this pipeline uses>",
   "sheetBridgeUrl": "<web app URL>",
   "sheetBridgeToken": "<token from step 4>"
   ```
7. Test: `node <skill_dir>/cp.js sheet push`. The tab fills with the table.
8. Install the watcher: `<skill_dir>/schedule/install-mac.sh <campaign folder>`
   (it installs the watcher automatically once the bridge is configured).

If the user's Google Workspace admin does not allow "Anyone" web apps, step 5
fails or the push returns an HTML page. Then use manual mode
(reference/gmail-and-sheet.md) or ask the admin.

After editing bridge.gs later, deploy a **new version** of the same deployment
(Deploy → Manage deployments → edit → New version) so the URL stays the same.

## What people write in 「你的决定」

| Write | Effect |
|---|---|
| 通过 | approve for first touch → draft appears |
| 跳过 | drop this creator |
| 报价 200 | set our first-touch price (before it is sent) |
| 锁价 / 锁价 280 | lock the deal (at the engine's price or 280) → deal email + contract |
| 接手 已签约 300 | bring someone in mid-way at that stage and price |
| 签了 | signed contract received |
| 收到脚本 / 不审脚本 | script arrived / skip script review |
| 脚本通过 / 脚本打回 意见 | approve / send revision notes (Chinese notes are translated by Claude) |
| 定金已付 PayPal | deposit paid → "deposit sent" email |
| 收到成片 / 成片通过 2026-12-01 / 成片打回 意见 | video review |
| 发布 https://… | posting link → balance + invoice email |
| 尾款已付 | settled |
| 重写 | re-draft an email whose Gmail draft was deleted |
| 暂停 / 取消 / 恢复 <阶段> | pause, cancel, resume |

The watcher clears the cell once done and writes 「决定结果」: ✓ done, ✗ not
understood or refused (the cell stays so the person can fix it), ⏳ waiting
for Claude. 「下一步」 always says, in plain Chinese, what happens next and
whether a person is needed (👉).

People may also add a creator by typing a new row (账号, 平台, 邮箱 at least);
the watcher picks it up and prices it. 备注 is theirs. Every other column is
written by the engine and overwritten on the next round.

## Timing

- A decision in the sheet → draft in Gmail: within one watcher interval
  (default 3 minutes).
- A draft sent in Gmail → row updated: within one interval.
- A creator replies → Claude reads it within the interval plus Claude's
  cool-down (`claudeCooldownMinutes`, default 15), then the next draft
  appears on the following round.
- The Mac must be on and logged in. When it sleeps, everything catches up on
  wake.

## What the bridge can and cannot do

It can only: read and write the sheet, create Gmail drafts, and tell whether
a draft still exists / was sent / whether a creator wrote back (times and
thread ids only, never email bodies). It cannot send email. Anyone holding
both the web app URL and the token could create drafts or read the tab, so
keep pipeline.config.json private (it is git-ignored) and regenerate the
token (delete the TOKEN script property, run `setup` again) if it leaks.

## Your role (Claude) when the bridge is on

- Do not create Gmail drafts with the Gmail connector for pipeline emails;
  run `cp.js watch-tick` instead, so every draft is tracked by id.
- When the user tells you a decision in chat, run `cp.js decide @h "<the same
  words>"` and then `cp.js watch-tick`.
- After reading a reply and recording it, always `cp.js handled @h`.
