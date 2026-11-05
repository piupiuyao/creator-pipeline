/** 把这一行该发的邮件拼好:正文 + 附件(合同/invoice 填好,brief 可选)。cp.js draft 和盯表任务共用。 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { dueAction, today } from './flow.js';
import { render, depositAmount, finalAmount } from './templates.js';
import { fillDocx } from './docx.js';

const MIME = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };

export function docValues(r, cfg) {
  const n = (r['姓名'] || '').trim();
  return {
    creator_name: n && !/^(nan|none|null)$/i.test(n) ? n : r['账号'].replace(/^@/, ''),
    handle: r['账号'], platform: r['平台'], profile_url: r['主页'], email: r['邮箱'],
    amount: r['成交价'], deposit: depositAmount(r, cfg), final_amount: finalAmount(r, cfg),
    date: today(), product_name: cfg.productName, product_url: cfg.productUrl,
    deliverables: (cfg.briefBullets?.length ? cfg.briefBullets : cfg.formats).join('; '),
    payment_terms: cfg.paymentTerms, sender_name: cfg.senderName,
    publish_link: r['发布链接'], publish_date: r['发布日期'],
  };
}

/** 返回 { ok, template, to, subject, body, attachments?, warning? } 或 { ok:false, reason }。 */
export function composeDraft(r, cfg, { template, notes, dir = '.' } = {}) {
  const due = dueAction(r, cfg);
  const id = template ?? due.template;
  if (!id) return { ok: false, reason: `${r['账号']} 现在没有该发的邮件(${due.why ?? due.kind})` };
  if (template && !['REVISE', 'ASK_RATE'].includes(id) && id !== due.template) return { ok: false, reason: `${r['账号']} 当前该发 ${due.template ?? '(无)'},不能指定 ${id}` };
  const briefFile = ['pdf', 'docx'].map((x) => join(dir, 'templates', `brief.${x}`)).find((f) => existsSync(f));
  const mail = render(id, r, cfg, { notes: notes ?? r['修改意见'], hasBrief: Boolean(briefFile) });
  if (!mail.ok) return mail;
  if (mail.attach) {
    mail.attachments = []; const warn = [];
    for (const kind of mail.attach) {
      const optional = kind.endsWith('?'), name = kind.replace('?', '');
      const label = { contract: 'Contract', invoice: 'Invoice', brief: 'Creative Brief' }[name];
      if (name === 'brief') {
        if (!briefFile) continue;
        if (briefFile.endsWith('.pdf')) { mail.attachments.push({ path: briefFile, filename: `${label} - ${cfg.productName}.pdf`, mimeType: MIME.pdf }); continue; }
      }
      const tpl = name === 'brief' ? briefFile : join(dir, 'templates', `${name}.docx`);
      if (!existsSync(tpl)) {
        if (optional) continue;
        return { ok: false, reason: `${{ contract: '合同', invoice: 'invoice' }[name] ?? name}模板没配置:把模板放到 templates/${name}.docx(没模板就不发,绝不用别人的)` };
      }
      const res = fillDocx(readFileSync(tpl), docValues(r, cfg));
      mkdirSync(join(dir, 'out'), { recursive: true });
      const path = join(dir, 'out', `${r['账号'].replace(/^@/, '')}-${name}.docx`);
      writeFileSync(path, res.buf);
      mail.attachments.push({ path, filename: `${label} - ${cfg.productName}.docx`, mimeType: MIME.docx, filled: res.applied, missing: res.missed });
      if (res.missed.length) warn.push(`${label} 里这些占位没值,发前要人补或留给达人填: ${res.missed.join(', ')}`);
    }
    if (warn.length) mail.warning = warn.join(';');
    delete mail.attach;
  }
  return { ...mail, template: id };
}
