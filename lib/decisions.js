/**
 * 「你的决定」列:人在 Google 表里写一句话,这里翻译成引擎命令执行。
 * 和在 Claude 里说的效果一样,只是不用开 Claude。看不懂的写回「决定结果」,不猜。
 */
import * as flow from './flow.js';
import { findRow } from './ops.js';

const DATE = '(\\d{4}-\\d{1,2}-\\d{1,2})';
const APPROVE = '通过|ok|okay|approve|approved|yes|y|批准|可以|同意|行|好|好的|✅|👍|✔️?';
const RULES = [
  [new RegExp(`^(${APPROVE})$`, 'i'), () => ({ cmd: 'approve' })],
  [new RegExp(`^(${APPROVE})\\s*\\$?(\\d+)$`, 'i'), (m) => ({ cmd: 'approve', price: Number(m[2]) })],
  [/^(报价|改价|首触报价)\s*\$?(\d+)\s*(通过|ok)$/i, (m) => ({ cmd: 'approve', price: Number(m[2]) })],
  [/^(跳过|skip|不要|不联系)$/i, () => ({ cmd: 'skip' })],
  [/^(重写|重新起草|redo)$/i, () => ({ cmd: 'redraft' })],
  [/^(报价|改价|首触报价)\s*\$?(\d+)$/, (m) => ({ cmd: 'offer', price: Number(m[2]) })],
  [/^(锁价|成交|lock)\s*\$?(\d+)?$/i, (m) => ({ cmd: 'lock', price: m[2] ? Number(m[2]) : undefined })],
  [/^接手\s*(\S+?)\s*\$?(\d+)$/, (m) => ({ cmd: 'takeover', stage: m[1], price: Number(m[2]) })],
  [/^(签了|已签约|合同签了|合同已签)$/, () => ({ cmd: 'stage', to: '已签约' })],
  [/^(收到脚本|脚本到了|交脚本了)$/, () => ({ cmd: 'stage', to: '脚本审核' })],
  [/^(不审脚本|跳过脚本)$/, () => ({ cmd: 'stage', to: '待付定金' })],
  [/^脚本(通过|ok|可以)$/i, () => ({ cmd: 'review', what: 'script', verdict: 'pass' })],
  [/^脚本(打回|要改|修改)[:：\s]*([\s\S]+)$/, (m) => ({ cmd: 'revise', what: 'script', notes: m[2].trim() })],
  [/^(收到成片|成片到了|交片了)$/, () => ({ cmd: 'stage', to: '成片审核' })],
  [new RegExp(`^成片(通过|ok|可以)\\s*${DATE}?$`, 'i'), (m) => ({ cmd: 'review', what: 'video', verdict: 'pass', date: m[2] })],
  [/^成片(打回|要改|修改)[:：\s]*([\s\S]+)$/, (m) => ({ cmd: 'revise', what: 'video', notes: m[2].trim() })],
  [/^定金(已付|付了)\s*(.*)$/, (m) => ({ cmd: 'paid', which: 'deposit', method: m[2].trim() || undefined })],
  [/^尾款(已付|付了)\s*(.*)$/, (m) => ({ cmd: 'paid', which: 'final', method: m[2].trim() || undefined })],
  [new RegExp(`^(发布|已发布|发了)\\s*(https?://\\S+)\\s*${DATE}?$`), (m) => ({ cmd: 'published', url: m[2], date: m[3] })],
  [/^(暂停|取消)$/, (m) => ({ cmd: 'stage', to: m[1] })],
  [/^(恢复)\s*(\S+)$/, (m) => ({ cmd: 'stage', to: m[2] })],
];

export function parseDecision(text) {
  // 宽容一点:全角空格/冒号统一;原话没对上时,去掉句尾的「了/啦/吧/!/。」再试(「通过了」=「通过」)
  const t = String(text ?? '').replace(/\u3000/g, ' ').replace(/：/g, ':').trim().replace(/[!！。~～]+$/u, '').trim();
  if (!t) return null;
  const loose = t.replace(/[了啦吧呀哈]+$/u, '').trim();
  for (const c of loose && loose !== t ? [t, loose] : [t]) {
    for (const [re, make] of RULES) { const m = c.match(re); if (m) return make(m); }
  }
  return { cmd: 'unknown' };
}

const pad = (d) => d && d.replace(/-(\d)(?=-|$)/g, '-0$1');

/** 执行一条决定。返回 { ok, msg, needsClaude? }。needsClaude = 要 Claude 处理(比如中文修改意见要翻成英文)。 */
export function applyDecision(rows, handle, text, cfg, now = flow.today()) {
  const d = parseDecision(text);
  const r = findRow(rows, handle);
  if (!d || !r) return { ok: false, msg: '表里没有这个人' };
  const res = (x, okMsg) => (x.ok ? { ok: true, msg: okMsg } : { ok: false, msg: x.reason });
  switch (d.cmd) {
    case 'approve': {
      if (r['发送1'] || r['阶段']) return { ok: false, msg: '已经联系过了,不用再通过' };
      if (d.price != null) {
        const x = setOffer(r, d.price); if (!x.ok) return x;
      } else if (!r['第1轮报价'] && cfg.firstTouchMode !== 'ask_rate' && !String(r['来源'] || '').startsWith('老合作')) {
        return { ok: false, msg: `还没有报价(${r['状态'] || '没数据'}):写「通过 价格」,如「通过 200」` };
      }
      r['审核'] = '通过';
      if (['跳过', '待审核', ...BLOCKED].includes(r['状态']) || !r['状态']) r['状态'] = '已通过';
      return { ok: true, msg: d.price != null ? `已通过,按 $${d.price} 起草首触` : '已通过,马上起草首触' };
    }
    case 'skip':
      if (r['发送1']) return { ok: false, msg: '已经发过首触了;不想继续请写「取消」' };
      r['状态'] = '跳过'; r['审核'] = '跳过'; if (r['草稿'] && !r['草稿'].startsWith('作废')) r['草稿'] = '作废 ' + r['草稿'];
      return { ok: true, msg: '已跳过' + (r['草稿'] ? '(Gmail 里那封草稿请删掉)' : '') };
    case 'redraft':
      if (!String(r['草稿'] || '').startsWith('作废')) return { ok: false, msg: '没有被删的草稿需要重写' };
      r['草稿'] = ''; return { ok: true, msg: '马上重新起草' };
    case 'offer': {
      const x = setOffer(r, d.price); if (!x.ok) return x;
      return { ok: true, msg: `首触报价改成 $${d.price}` + (r['审核'] === '通过' ? '' : ',写「通过」就起草') };
    }
    case 'lock': return res(flow.lock(rows, handle, d.price, now), '已锁价,马上起草成交确认+合同');
    case 'takeover': return res(flow.lock(rows, handle, d.price, now, d.stage), `已接手,从「${d.stage}」开始`);
    case 'stage': return res(flow.moveStage(rows, handle, d.to, now), `已更新到「${d.to}」`);
    case 'review': return res(flow.review(rows, handle, d.what, d.verdict, { date: pad(d.date) }, now), `${d.what === 'script' ? '脚本' : '成片'}已通过,马上起草通知`);
    case 'revise': {
      const chk = flow.review(rows, handle, d.what, 'revise', {}, now);
      if (!chk.ok) return { ok: false, msg: chk.reason };
      if (/[^\x00-\x7F]/.test(d.notes)) return { ok: true, needsClaude: 'translate', msg: '修改意见是中文,等 Claude 翻成英文后起草' };
      r['修改意见'] = d.notes; return { ok: true, msg: '马上起草修改意见' };
    }
    case 'paid': return res(flow.paid(rows, handle, d.which, { method: d.method }, now), d.which === 'deposit' ? '已记定金,马上起草通知' : '已结清,马上起草"尾款已付"通知');
    case 'published': return res(flow.published(rows, handle, d.url, pad(d.date), now), '已记发布,马上起草尾款+invoice');
    default: {
      // 按这一行现在卡在哪给提示,不把全部写法都列出来
      const hint = flow.nextStepText(r, cfg, now).replace(/^👉\s*/, '');
      return { ok: false, msg: `没看懂。${hint ? `这一行现在:${hint}` : '常用写法:通过 / 跳过 / 通过 200 / 锁价 / 签了 / 脚本通过 / 定金已付 PayPal / 发布 链接 / 尾款已付'}` };
    }
  }
}

// 引擎不出价的几种状态:人给了价就放行
const BLOCKED = ['缺播放', '缺粉丝数', 'KOL手动', '超上限待人工', '单太小', '买量嫌疑'];
function setOffer(r, price) {
  if (r['发送1']) return { ok: false, msg: '首触已发,不能再改首触报价' };
  if (r['草稿']) return { ok: false, msg: '草稿已经建好了:先在 Gmail 删掉那封草稿,再改价' };
  if (!(price > 0)) return { ok: false, msg: '价格要大于 0' };
  r['第1轮报价'] = price;
  if (BLOCKED.includes(r['状态'])) r['状态'] = r['审核'] === '通过' ? '已通过' : '待审核';
  return { ok: true };
}
