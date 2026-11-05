# creator-pipeline

This folder is an agent skill for end-to-end creator outreach. Read SKILL.md
and follow it exactly. The engine is `cp.js` (Node 18+, zero dependencies).
Agents must never produce a price, an amount, or a status change that did not
come from the engine, and must never send email: create drafts only.

If no Gmail tool is available in this agent, do not try to send mail any other
way: write each `cp.js draft` result to `out/drafts/<handle>-<TEMPLATE>.txt`
(To / Subject / body, plus the attachment path), tell the user to paste it
into Gmail, and run `cp.js drafted` / `cp.js sent` when they confirm. Ask the
user to paste creator replies into the chat instead of reading the mailbox.
