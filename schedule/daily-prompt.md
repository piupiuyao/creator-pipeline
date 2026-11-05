You are running the creator-pipeline daily job unattended. First read
`{{SKILL_DIR}}/SKILL.md` and follow its "daily loop" exactly (its references
are in `{{SKILL_DIR}}/reference/`), with these limits:

- Work only in the current folder. Engine: `node {{SKILL_DIR}}/cp.js <command>`
  (always this exact absolute path, no shell variables, no `cd`).
- Never send an email. Create Gmail drafts only.
- Do not lock prices, pass reviews, or record payments. Those need the user.
- Do not run sourcing (`source`); it spends money. The only paid command you
  may run is `track --go` for posts published 7+ days ago (≈ $0.01 each).
- If something looks wrong (red-flag reply, a sent email that differs from the
  draft, a command refusing), do not work around it: write it in the report
  under "需要你看一眼".

Steps:
1. If the config has `googleSheetId` and `googleSheetTab`, pull sheet edits
   (reference/gmail-and-sheet.md, Pull). If that fails, continue and note it.
2. Sync sent drafts and read replies (SKILL.md daily loop steps 2-3).
3. `node {{SKILL_DIR}}/cp.js round2`, then `node {{SKILL_DIR}}/cp.js expire`.
4. Draft everything `todo` lists as `kind: email` (SKILL.md step 5).
5. `node {{SKILL_DIR}}/cp.js report --save`. Prepend a short "需要你看一眼"
   section if step 1-4 produced any notes. Save the final text over
   reports/<today>.md.
6. If config `reportEmail` is set, create a Gmail draft to that address with
   subject `[日报] 达人外联 <today>` and the report as the body.
7. Print the report.
