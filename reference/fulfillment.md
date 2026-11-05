# After the deal: contract → script → deposit → video → publish → balance

The 阶段 column tracks this part. `cp.js todo` always tells you the next step;
this file explains each stop and what you do there.

| 阶段 | What it means | Who moves it | Email (template) |
|---|---|---|---|
| 待发合同 | price locked | `lock` | DEAL: deal recap + contract attached |
| 合同已发 | DEAL was sent | `sent … DEAL` | after 1 day unsigned: CONTRACT_FU (once) |
| 已签约 | signed contract came back | you: `stage @h 已签约` | none, wait for script |
| 脚本审核 | script / draft arrived | you: `stage @h 脚本审核` | none, the user reviews |
| 脚本已通过 | user approved script | `review @h script pass` | SCRIPT_OK: asks for payment details |
| 待付定金 | SCRIPT_OK sent | `sent … SCRIPT_OK` | none, the user pays |
| 定金已付 | user paid deposit | `paid @h deposit [--method X]` | DEPOSIT_SENT |
| 成片审核 | final video arrived | you: `stage @h 成片审核` | none, the user reviews |
| 成片已通过 | user approved video | `review @h video pass [--date D]` | VIDEO_OK: confirms or asks posting date |
| 待发布 | VIDEO_OK sent | `sent … VIDEO_OK` | none, wait for the link |
| 已发布 | link arrived | you: `published @h <url> [date]` | FINAL_INVOICE: balance + invoice attached |
| 尾款待付 | FINAL_INVOICE sent | `sent … FINAL_INVOICE` | none, the user pays |
| 已结清 | balance paid | `paid @h final` | none |

Also: `stage @h 暂停` / `stage @h 取消` from anywhere; from 暂停 any stage.
No script review in this deal: `stage @h 待付定金` straight from 已签约.
Revision requests (script or video): `review @h script revise` (or `video`),
then `draft @h --template REVISE --notes "<the user's words>"`. The stage
stays where it is; when the new version arrives, review again.

Amounts: deposit = 成交价 × depositPct (default 50%), balance = the rest. The
templates compute them; you never type an amount.

## Contract and invoice templates

The user supplies their own `.docx` files:

- `templates/contract.docx`: attached to the DEAL email
- `templates/invoice.docx`: attached to the FINAL_INVOICE email

If they keep them in Google Docs: download each as .docx (Drive connector,
exportMimeType `application/vnd.openxmlformats-officedocument.wordprocessingml.document`)
and save into templates/.

Write placeholders in the document as `{{token}}`. Available tokens:

| Token | Value |
|---|---|
| `{{creator_name}}` | creator's name (falls back to handle) |
| `{{handle}}` `{{platform}}` `{{profile_url}}` `{{email}}` | from the sheet |
| `{{amount}}` | total fee (成交价) |
| `{{deposit}}` `{{final_amount}}` | deposit and balance |
| `{{date}}` | today |
| `{{product_name}}` `{{product_url}}` | from config |
| `{{deliverables}}` | briefBullets (or formats), joined with "; " |
| `{{payment_terms}}` `{{sender_name}}` | from config |
| `{{publish_link}}` `{{publish_date}}` | after publishing |

Anything else (creator's address, signature, bank details) stays as a
`{{placeholder}}` or blank line for the creator to fill. `draft` reports which
tokens had no value in `warning`; mention it to the user before they send.

A paragraph containing a placeholder keeps the style of its first piece of
text. Put placeholders in plain paragraphs, not mixed bold/italic runs.

Optional creative brief: `templates/brief.pdf` is attached to the DEAL email
as-is; `templates/brief.docx` is filled with the same tokens first.

## Attaching in Gmail

`draft` returns `attachments: [{ path, filename, mimeType }]`. Base64-encode
each file (`base64 -i <path>` on macOS, `base64 -w0 <path>` on Linux) and pass
them in the Gmail draft's attachments with that filename and mimeType.

## When the signed contract comes back

If it is a .docx: save it (e.g. `out/<handle>-signed.docx`) and run
`cp.js contract-check @h out/<handle>-signed.docx`. It compares every
paragraph with what we sent; placeholders we left blank for the creator are
allowed to change, nothing else is. Any difference (fee, payment days, usage
rights...) goes to the user before `stage @h 已签约`. A PDF cannot be
compared automatically: read it and point out anything that differs from
the contract we sent, then let the user decide.

## After publishing

`cp.js track --go` (about $0.01 per post) fills 发布播放, 实际CPM
(成交价 ÷ views × 1000) and 提到产品 (does the caption mention the product
name or domain). Run it about 7 days after publishing; `--all` re-checks
posts already tracked.
