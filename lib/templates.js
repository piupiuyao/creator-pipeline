/**
 * 全链路邮件模板(纯文本,直接进 Gmail 草稿)。
 *  - 外联/砍价段沿用 negotiation.md 的写法规矩:不哭穷、不用 em dash、数字只复述引擎的。
 *  - 履约段(合同→脚本→定金→成片→发布→尾款)移植自平台版定稿文案,品牌话术全部读配置。
 *  - 金额全部在这里由成交价算出(定金 = 成交价 × depositPct),模型不碰数字。
 */
import { missingVoice } from './config.js';

const num = (v) => { const n = Number(String(v ?? '').replace(/[$,\s]/g, '')); return Number.isFinite(n) && String(v).trim() !== '' ? n : null; };
const money = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

/** 称呼:只用干净的拉丁名;怪名字(数字/表情/头衔/空/nan)一律 "there",绝不发 "Hi Dr.," 或 "Hi nan"。 */
export function firstName(row) {
  const raw = String(row['姓名'] ?? '').trim();
  if (!raw || /^(nan|none|null)$/i.test(raw)) return 'there';
  const first = raw.split(/\s+/)[0].replace(/[,.]$/, '');
  if (/^(dr|mr|mrs|ms|miss|prof|coach)\.?$/i.test(first)) return 'there';
  if (!/^[A-Za-zÀ-ÖØ-öø-ÿ'-]{2,20}$/.test(first)) return 'there';
  return first[0].toUpperCase() + first.slice(1);
}

export function depositAmount(row, cfg) {
  const price = num(row['成交价']);
  if (price == null || price <= 0) return null;
  return Math.round(price * (cfg.depositPct ?? 50)) / 100;
}
export function finalAmount(row, cfg) {
  const price = num(row['成交价']), dep = depositAmount(row, cfg);
  if (price == null || dep == null) return null;
  return Math.round((price - dep) * 100) / 100;
}

const sign = (body, cfg) => `${body.trim()}\n\nBest,\n${cfg.senderName}${cfg.companyName ? `\n${cfg.companyName}` : ''}`;
/** 2026-11-20 → "Friday, Nov 20"(英文邮件里不写 ISO 日期) */
export function niceDate(d) {
  const t = Date.parse(`${String(d).slice(0, 10)}T12:00:00`);
  if (!Number.isFinite(t)) return String(d);
  return new Date(t).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}
const viaOf = (stamp) => (stamp && / via /.test(stamp) ? stamp.split(' via ')[1].trim() : '');
const bullets = (items) => items.map((s) => `- ${String(s).trim()}`).join('\n');
const subjectFor = (cfg, row) => {
  const n = firstName(row);
  return `Paid Collaboration Inquiry - ${cfg.productName} x ${n === 'there' ? 'You' : n}`;
};
const platformLabel = (p) => ({ tiktok: 'TikTok', instagram: 'Instagram', youtube: 'YouTube' }[(p || '').toLowerCase()] ?? 'social');
const termsText = (cfg) => cfg.paymentTerms?.trim()
  || `${cfg.depositPct ?? 50}% upfront after script approval, the rest after the video is live`;

/** 每个模板:需要的行字段由 render 统一校验,缺就拒绝出稿。 */
const T = {
  FIRST(row, cfg) {
    if (String(row['来源'] || '').startsWith('老合作')) return T.RECALL(row, cfg);
    const pitch = cfg.productPitch
      ? `We're reaching out about ${cfg.productName}, ${cfg.productPitch.replace(/[.!。]+$/, '')}.`
      : `We're reaching out about ${cfg.productName}, and thought your audience could be a strong fit.`;
    const ask = cfg.firstTouchMode === 'ask_rate'
      ? `If you're open to it, could you share your rate card or the best way to scope a first collaboration?`
      : `For this scope, ${cfg.scope}, we can offer $${row['第1轮报价']}. If that works, we can get started this week.`;
    return {
      subject: subjectFor(cfg, row),
      body: sign(`Hi ${firstName(row)},

I came across your ${platformLabel(row['平台'])} profile and liked the way you explain things to your audience.

${pitch}

We're exploring paid creator collaborations and would love to see whether one of these could fit your content style:
${bullets(cfg.formats)}

${ask}

Product link: ${cfg.productUrl}`, cfg),
    };
  },

  // 老合作方返场:只说"你在我们的合作名单里",不编造上次合作的细节
  RECALL(row, cfg) {
    const pitch = cfg.productPitch
      ? `For this one, ${cfg.productName} is ${cfg.productPitch.replace(/[.!。]+$/, '')}.`
      : `For this one, we think your audience could be a strong fit for ${cfg.productName}.`;
    const ask = cfg.firstTouchMode === 'ask_rate' || !row['第1轮报价']
      ? `If the timing is good, could you share your current rate or let us know which format fits best?`
      : `For this scope, ${cfg.scope}, we can offer $${row['第1轮报价']}. If that works, we can get started this week.`;
    return {
      subject: `New Paid Collaboration - ${cfg.productName} x ${firstName(row) === 'there' ? 'You' : firstName(row)}`,
      body: sign(`Hi ${firstName(row)},

You're on our creator roster, and we'd love to work with you again on a new paid collaboration.

${pitch}

We're currently considering:
${bullets(cfg.formats)}

${ask}

Product link: ${cfg.productUrl}`, cfg),
    };
  },

  FIRST_FU(row, cfg) {
    return {
      subject: `Re: ${subjectFor(cfg, row)}`,
      body: sign(`Hi ${firstName(row)},

Just following up on my note about a paid collaboration with ${cfg.productName}.

No worries if timing is not right. If it is interesting, a quick yes/no${cfg.firstTouchMode === 'ask_rate' ? ' or your rate card' : ''} would be perfect.`, cfg),
    };
  },

  ASK_RATE(row, cfg) {
    return {
      subject: 'Re: rate card',
      body: sign(`Hi ${firstName(row)},

Thanks for the quick reply! Happy to share more context.

We're inviting creators to feature ${cfg.productName}${cfg.productPitch ? `, ${cfg.productPitch.replace(/[.!。]+$/, '')}` : ''} (${cfg.productUrl}). For this campaign we're looking for ${cfg.scope}, kept in your usual style.

Could you share your rate for:
${bullets([...cfg.formats, 'Any bundle options you offer'])}

Once we have those we'll put together a concrete proposal.`, cfg),
    };
  },

  COUNTER(row, cfg) {
    const final = row['状态'] === '第2轮待审'; // 第2轮到顶 = 公允价,用"最多到这"口径
    const line = final
      ? `We went back over our numbers, and $${row['第2轮报价']} is the most we can do for this scope. If that works for you, we are good to move forward right away.`
      : `For this scope, ${cfg.scope}, we can offer $${row['第2轮报价']}. If that works, we can get started this week.`;
    return { subject: 'Re: our offer', body: sign(`Hi ${firstName(row)},\n\nThanks for the quote. ${line}`, cfg) };
  },

  OUT_OF_RANGE(row, cfg) {
    const v = num(row['流量价值']);
    const range = v < 100 ? Math.round(v / 5) * 5 : Math.round(v / 10) * 10;
    return {
      subject: 'Re: our offer',
      body: sign(`Hi ${firstName(row)},

Thanks for sharing your rate. For this scope our range is around $${range}, so it sounds like we are pretty far apart this time. Totally understand, and if that range ever works on your end we would be glad to pick this back up.`, cfg),
    };
  },

  CLOSE_REJECTED(row, cfg) {
    return {
      subject: 'Re: collaboration',
      body: sign(`Hi ${firstName(row)},\n\nTotally understood, thanks for considering it. If things change down the road, we would love to revisit.`, cfg),
    };
  },

  // 成交确认 + 合同(附件)。只在人锁价之后出。
  DEAL(row, cfg, extra) {
    const req = cfg.briefBullets?.length ? cfg.briefBullets : cfg.formats;
    return {
      subject: 'Brief & next steps',
      attach: ['contract', 'brief?'],
      body: sign(`Hi ${firstName(row)},

That sounds great! Happy to move forward at $${row['成交价']} for this first collaboration.

Here's a quick recap of the collaboration details:

Content requirements:
${bullets(req)}

Payment terms:
- ${termsText(cfg)} (exact terms per the attached contract)

Next steps: the contract${extra.hasBrief ? ' and the creative brief are' : ' is'} attached. Please review it, fill in your details, sign, and send it back so we can get started. Product access: ${cfg.productUrl}

Looking forward to working together!`, cfg),
    };
  },

  CONTRACT_FU(row, cfg) {
    return {
      subject: 'Following up: contract',
      body: sign(`Hi ${firstName(row)},

Just following up on the contract we sent over, wanted to make sure it landed safely in your inbox.

Whenever you have a moment, please review the document, fill in your details, sign it, and send it back so we can get started. Product access is already live at ${cfg.productUrl} whenever you're ready to explore.

Let me know if you have any questions!`, cfg),
    };
  },

  SCRIPT_OK(row, cfg) {
    const dep = depositAmount(row, cfg);
    return {
      subject: 'Script approved: next step is your deposit',
      body: sign(`Hi ${firstName(row)},

Great news: your script is approved! Really happy with the direction.

To get your upfront deposit of $${money(dep)} on its way, could you send over your payment details (PayPal or bank info)?

Once the deposit is sent, feel free to start filming. Looking forward to seeing the video come together!`, cfg),
    };
  },

  // 脚本/成片打回。意见必须是用户原话(--notes),模型不自己编修改意见。
  REVISE(row, cfg, extra) {
    return {
      subject: 'Small tweaks on the draft',
      body: sign(`Hi ${firstName(row)},

Thanks so much for sending this over, it's looking great overall!

Just a few small adjustments before we're good to go:

${extra.notes}

Looking forward to the updated version!`, cfg),
    };
  },

  DEPOSIT_SENT(row, cfg) {
    const dep = depositAmount(row, cfg);
    const via = viaOf(row['定金已付']) ? ` via ${viaOf(row['定金已付'])}` : '';
    return {
      subject: 'Deposit sent',
      body: sign(`Hi ${firstName(row)},

Quick update: your deposit of $${money(dep)} has just been sent${via}. Please let us know once it arrives on your side.

Feel free to start filming whenever you're ready. Excited to see the video come together!`, cfg),
    };
  },

  VIDEO_OK(row, cfg) {
    const when = row['发布日期']
      ? `For the posting date, ${niceDate(row['发布日期'])} works on our end, so let's lock that in.`
      : `Next step: could you share your planned posting date so we can lock the schedule?`;
    return {
      subject: 'Video approved, scheduling next',
      body: sign(`Hi ${firstName(row)},

Great news: the video is approved! Really happy with how it turned out.

${when}

Once the content is live, please share the posting link so we can wrap up the final payment.`, cfg),
    };
  },

  FINAL_INVOICE(row, cfg) {
    const fin = finalAmount(row, cfg), via = viaOf(row['定金已付']);
    // 定金时已经拿到收款方式的,不再让对方重填,只确认沿用
    const fill = via
      ? `Attached is our invoice template. Please fill it in, sign, and send it back. We'll pay to the same ${via} account as the deposit unless you tell us otherwise.`
      : `Attached is our invoice template. Please fill in your payment details, sign, and send it back.`;
    const days = Number(cfg.finalPaymentDays) > 0 ? ` Payment will be made within ${cfg.finalPaymentDays} business days of receiving your invoice.` : '';
    return {
      subject: 'Final payment & invoice',
      attach: ['invoice'],
      body: sign(`Hi ${firstName(row)},

The video is live and it looks great. Thanks for the excellent work!

We're ready to process your final payment of $${money(fin)} (the remaining balance).

${fill}${days}

Thanks again for the collaboration!`, cfg),
    };
  },

  FINAL_SENT(row, cfg) {
    const fin = finalAmount(row, cfg), via = viaOf(row['尾款已付']);
    return {
      subject: 'Final payment sent',
      body: sign(`Hi ${firstName(row)},

Quick update: your final payment of $${money(fin)} has just been sent${via ? ` via ${via}` : ''}. Please let us know once it arrives on your side.

That wraps up this collaboration. Thank you for the great work, and we'd love to work with you again!`, cfg),
    };
  },
};

export const TEMPLATE_IDS = Object.keys(T);

/** 渲染。缺配置/缺金额/缺邮箱 → 返回 {ok:false} 并说明原因,绝不硬出。 */
export function render(id, row, cfg, extra = {}) {
  if (!T[id]) return { ok: false, reason: `没有模板 ${id}` };
  const miss = missingVoice(cfg);
  if (miss.length) return { ok: false, reason: `配置缺: ${miss.join(', ')}` };
  if (!row['邮箱']) return { ok: false, reason: '这一行没有邮箱' };
  if (['FIRST', 'ASK_RATE'].includes(id) && !cfg.formats?.length) return { ok: false, reason: '配置缺 formats(合作形式),首触和询价信要列出来' };
  if (id === 'FIRST' && cfg.firstTouchMode !== 'ask_rate' && !row['第1轮报价'] && !String(row['来源'] || '').startsWith('老合作')) return { ok: false, reason: '没有第1轮报价' };
  if (id === 'COUNTER' && !row['第2轮报价']) return { ok: false, reason: '没有第2轮报价' };
  if (id === 'OUT_OF_RANGE' && num(row['流量价值']) == null) return { ok: false, reason: '没有流量价值' };
  if (['DEAL', 'SCRIPT_OK', 'DEPOSIT_SENT', 'FINAL_INVOICE', 'FINAL_SENT'].includes(id) && !(num(row['成交价']) > 0)) {
    return { ok: false, reason: '没有成交价(先 lock)' };
  }
  if (id === 'REVISE' && !String(extra.notes ?? '').trim()) return { ok: false, reason: '打回意见要用户原话: --notes "..."' };
  const mail = T[id](row, cfg, extra);
  const text = `${mail.subject}\n${mail.body}`;
  if (/[—]/.test(text)) return { ok: false, reason: '邮件里出现 em dash,检查配置文字' };
  return { ok: true, to: row['邮箱'], ...mail };
}
