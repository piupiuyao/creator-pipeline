# Gmail and the Google Sheet

## Gmail: drafts only

Every email goes into Gmail as a **draft**. The human opens Gmail, reads it,
edits if they like, and presses send. You never call a send tool.

Creating a draft from `cp.js draft @h` output:

- `to`: the JSON `to`; `subject`: the JSON `subject`; `body`: the JSON `body`
  (plain text, no Markdown).
- **Threading**: everything after the first touch should sit in the same
  thread. Find the latest message in the conversation with that address
  (search `to:<email> OR from:<email>`) and pass its id as `replyToMessageId`.
  Gmail then threads it and keeps the "Re:" subject. Only FIRST starts a new
  thread.
- Attachments: see reference/fulfillment.md.
- Then run `cp.js drafted @h TEMPLATE` immediately, so a crash mid-batch never
  produces a second draft for the same person.
- Never create more than one draft per person per run.

Detecting that the human sent it (daily sync):

- Search `in:sent to:<email> after:<draft date as YYYY/MM/DD>`. A sent message
  whose subject matches the draft's subject (or is in the same thread) means
  sent → `cp.js sent @h TEMPLATE`.
- If the draft no longer exists in Drafts and nothing was sent, the human
  discarded it → `cp.js undraft @h` (it will be drafted again next run unless
  they also mark the row 跳过; mention it in the report).
- If the human sent something different from the draft (edited price!),
  record what they actually committed to and flag it to the user.

Reading replies: only the LATEST inbound message decides 他的要价 and 回复类型
(reference/negotiation.md). Agencies and managers replying for the creator
count as the creator.

## The Google Sheet: the team's view

`creators.csv` in the campaign folder is what the engine reads and writes.
The Google Sheet tab is the team's window onto it. Two directions:

**Push (engine → sheet)**, after each run:

1. `node <skill_dir>/cp.js tsv > /tmp/creators.tsv` and copy it to the
   clipboard (`pbcopy < /tmp/creators.tsv` on macOS).
2. In Chrome (Claude in Chrome), open the sheet, click the Name Box (left of
   the formula bar), type `'<tab name>'!A1`, press Enter, then paste
   (Cmd+V / Ctrl+V). This overwrites the tab from A1 with the current table.
3. Verify by re-reading the sheet (Drive connector) that the row count matches.

Use a dedicated tab for this pipeline. Never paste over a tab the team
uses for something else. If the tab has rows below the table that the
paste would not cover (the table shrank), tell the user rather than deleting.

**Pull (sheet → engine)**, before each run. People may edit three things in
the sheet: 第1轮报价 (before the first email is sent), 状态 = 跳过, and 备注.

1. Drive connector `download_file_content` on the sheet with exportMimeType
   `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, save
   the decoded bytes as `out/sheet.xlsx`. (CSV export only returns the first
   tab, so use xlsx.)
2. `node <skill_dir>/cp.js pull out/sheet.xlsx --tab "<tab name>"`.

Everything else in the sheet is engine output; edits to other columns are
overwritten on the next push. Tell the team this once at setup.

**No Chrome?** Then the sheet cannot be written by you. Keep creators.csv
as the source of truth, and after each run upload a dated copy to Drive
(`create_file` with the TSV, converted to a Google Sheet) so the team can
look at it. Pull still works.
