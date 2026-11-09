/**
 * 全链路流程:每一行"下一步该干嘛"由这里确定性算出,agent 只照做。
 *
 *   外联段(状态列)  待审核 → 已通过 → 已发首触 → (3天) 跟进 → (再5天) 失联
 *                    回信 → round2 → 第2轮 / 成交待锁 / 放弃 / 已关闭
 *   履约段(阶段列)  待发合同 → 合同已发 → 已签约 → 脚本审核 → 脚本已通过 → 待付定金
 *                    → 定金已付 → 成片审核 → 成片已通过 → 待发布 → 已发布 → 尾款待付 → 已结清
 *
 * 三类动作:email(该起草哪封)/ human(卡人工,说明原因)/ wait(等达人)。
 * Gmail 里还躺着一封草稿、但进度已经变了(比如催合同还没发,对方已经签回) → stale,要撤掉。
 * 人工关口:审首触草稿、锁价、审脚本、审成片、付定金、付尾款,其余机器做。
 */
import { findRow } from './ops.js';

export const STAGES = ['待发合同', '合同已发', '已签约', '脚本审核', '脚本已通过', '待付定金',
  '定金已付', '成片审核', '成片已通过', '待发布', '已发布', '尾款待付', '已结清', '暂停', '取消'];

// 人手动推进的阶段跳转(其余跳转由 mark-sent / review / paid / published 自动完成)
const MANUAL_MOVES = {
  合同已发: ['已签约'],
  已签约: ['脚本审核', '待付定金'], // 不审脚本的合作可直接去付定金
  定金已付: ['成片审核'],
  成片已通过: ['待发布'],
};

const NEED_HUMAN = {
  KOL手动: '5万粉以上,价格由你定:写「通过 价格」,如「通过 600」',
  超上限待人工: '算出的报价超过自动上限,价格由你定:写「通过 价格」或「跳过」',
  缺播放: '没有平均播放,引擎不出价:写「通过 价格」按你的价发,或「跳过」',
  缺粉丝数: '没有粉丝数,引擎不出价:写「通过 价格」按你的价发,或「跳过」',
  买量嫌疑: '播放高但互动极低,疑似买量:还要发就写「通过 价格」,否则「跳过」',
  单太小: '算出的报价太低不值得谈:还要发就写「通过 价格」,否则「跳过」',
  异常缺价值: '数据异常,需要你看一眼',
  成交待锁: '对方已接受/价格在范围内,等你锁价:写「锁价」',
};

const CLOSED = new Set(['跳过', '失联', '已关闭']);

export const today = () => new Date().toLocaleDateString('sv-SE'); // 本地日期 YYYY-MM-DD
export function daysSince(date, now = today()) {
  if (!date) return null;
  const a = Date.parse(String(date).slice(0, 10)), b = Date.parse(now);
  return Number.isFinite(a) ? Math.floor((b - a) / 86_400_000) : null;
}
const logged = (row, id) => String(row['邮件记录'] || '').split(';').some((s) => s.trim().startsWith(id + ' '));
const noReply = (row) => !row['他的要价'] && !row['回复类型'];

/** 这一行下一步。 */
export const hasNewReply = (row) => Boolean(row['最新来信']) && (!row['已处理来信'] || row['最新来信'] > row['已处理来信']);
export const PRE_SEND = new Set(['待审核', '已通过']);

export function dueAction(row, cfg, now = today()) {
  if (hasNewReply(row)) return { kind: 'reply', why: `有新回信,等 Claude 读完记录(${cfg.claudeCooldownMinutes ?? 15} 分钟内)` };
  if (String(row['草稿'] || '').startsWith('作废')) {
    if (row['状态'] === '跳过') return { kind: 'none' };
    return { kind: 'human', why: 'Gmail 里的草稿被删了、没发出:写「重写」重新起草,或写「跳过」' };
  }
  if (row['草稿']) {
    const tpl = row['草稿'].split(' ')[0];
    // 草稿建好后进度又变了(对方回信/签回/人推进了阶段):这封不该再发
    const fresh = dueAction({ ...row, 草稿: '' }, cfg, now);
    const manualOk = tpl === 'ASK_RATE' && !row['阶段'] && !row['成交价'];
    if (fresh.template !== tpl && !manualOk) {
      return { kind: 'stale', template: tpl, why: `Gmail 里那封「${templateName(tpl)}」已过时(进度变了),不要发` };
    }
    return { kind: 'drafted', template: tpl, why: 'Gmail 草稿箱里等你审核发送' };
  }
  const stage = row['阶段'], st = row['状态'];

  if (stage) {
    switch (stage) {
      case '待发合同': return { kind: 'email', template: 'DEAL' };
      case '合同已发':
        if (!row['合同跟进'] && daysSince(row['阶段更新'], now) >= cfg.contractFollowupAfterDays) return { kind: 'email', template: 'CONTRACT_FU' };
        return { kind: 'wait', why: '等对方签合同' };
      case '已签约': return { kind: 'wait', why: '等对方交脚本' };
      case '脚本审核':
        if (row['修改意见']) return { kind: 'email', template: 'REVISE' };
        return { kind: 'human', why: '审脚本:写「脚本通过」或「脚本打回 意见」' };
      case '脚本已通过': return { kind: 'email', template: 'SCRIPT_OK' };
      case '待付定金': return { kind: 'human', why: '去付定金,付完写「定金已付 渠道」' };
      case '定金已付':
        if (!logged(row, 'DEPOSIT_SENT')) return { kind: 'email', template: 'DEPOSIT_SENT' };
        return { kind: 'wait', why: '等对方交成片' };
      case '成片审核':
        if (row['修改意见']) return { kind: 'email', template: 'REVISE' };
        return { kind: 'human', why: '审成片:写「成片通过 [发布日期]」或「成片打回 意见」' };
      case '成片已通过': return { kind: 'email', template: 'VIDEO_OK' };
      case '待发布': return { kind: 'wait', why: '等对方发布并回链接' };
      case '已发布': return { kind: 'email', template: 'FINAL_INVOICE' };
      case '尾款待付': return { kind: 'human', why: '收到 invoice 后付尾款,付完写「尾款已付」' };
      case '已结清':
        // 付完尾款发一封"已付+感谢";接手时已结清的、升级前就结清的老行不补发
        if (row['尾款已付'] && !logged(row, 'FINAL_SENT') && daysSince(row['阶段更新'], now) <= 3) return { kind: 'email', template: 'FINAL_SENT' };
        return { kind: 'none' };
      default: return { kind: 'none' }; // 暂停 / 取消
    }
  }

  if (CLOSED.has(st)) {
    if (st === '已关闭' && row['回复类型'] === '拒绝' && !logged(row, 'CLOSE_REJECTED') && !logged(row, 'OUT_OF_RANGE')) {
      return { kind: 'email', template: 'CLOSE_REJECTED' };
    }
    return { kind: 'none' };
  }
  if (PRE_SEND.has(st) && !row['发送1']) {
    if (cfg.requireApproval && row['审核'] !== '通过') return { kind: 'human', why: '等你审核:写「通过」或「跳过」(想改价写「报价 200」)' };
    return { kind: 'email', template: 'FIRST' };
  }
  if (NEED_HUMAN[st]) return { kind: 'human', why: NEED_HUMAN[st] };
  if (st === '回信无价待人工') {
    if (row['回复类型'] === '问详情' && cfg.firstTouchMode === 'ask_rate' && !logged(row, 'ASK_RATE')) {
      return { kind: 'email', template: 'ASK_RATE' };
    }
    return { kind: 'human', why: '对方回信了但没报价:按 brief.md 回答问题,或问对方报价' };
  }
  if ((st || '').startsWith('第2轮待审') && !row['发送2']) return { kind: 'email', template: 'COUNTER' };
  if (st === '放弃-超3倍' && !logged(row, 'OUT_OF_RANGE')) return { kind: 'email', template: 'OUT_OF_RANGE' };
  if (st === '已发第2轮') return { kind: 'wait', why: '等对方回第2轮' };

  if (row['发送1'] && noReply(row)) {
    if (!row['跟进1']) {
      // 21 天前的首触不再跟进(导入的旧名单),直接沉底
      if (daysSince(row['发送1'], now) > 21) return { kind: 'expire', why: '首触超过 21 天没回,不再跟进' };
      if (daysSince(row['发送1'], now) >= cfg.followupAfterDays) return { kind: 'email', template: 'FIRST_FU' };
      return { kind: 'wait', why: '首触已发,等回信' };
    }
    if (daysSince(row['跟进1'], now) >= cfg.noResponseAfterDays) return { kind: 'expire', why: '跟进后仍没回,标失联' };
    return { kind: 'wait', why: '已跟进,等回信' };
  }
  return { kind: 'none' };
}

/** 草稿已建进 Gmail:记下来,防止第二天重复起草。 */
export function markDrafted(rows, handle, id, now = today(), cfg, draftId = '') {
  const r = findRow(rows, handle);
  if (!r) return { ok: false, reason: `表里没有 ${handle}` };
  if (r['草稿']) return { ok: false, reason: `${handle} 已有草稿 ${r['草稿']},先处理它` };
  const due = dueAction(r, cfg, now);
  const manual = ['REVISE', 'ASK_RATE'].includes(id);
  if (!manual && due.template !== id) return { ok: false, reason: `${handle} 当前该发的是 ${due.template ?? '(无)'},不是 ${id}` };
  r['草稿'] = `${id} ${now}${draftId ? ' ' + draftId : ''}`;
  return { ok: true };
}

/** 草稿被人在 Gmail 发出后调用:记发送并推进状态。 */
const SENT_EFFECTS = {
  FIRST: (r, d) => { r['发送1'] = d; r['状态'] = '已发首触'; },
  FIRST_FU: (r, d) => { r['跟进1'] = d; },
  ASK_RATE: () => {},
  COUNTER: (r, d) => { r['发送2'] = d; r['状态'] = '已发第2轮'; },
  OUT_OF_RANGE: (r) => { r['状态'] = '已关闭'; },
  CLOSE_REJECTED: (r) => { r['状态'] = '已关闭'; },
  DEAL: (r, d) => { r['阶段'] = '合同已发'; r['阶段更新'] = d; },
  CONTRACT_FU: (r, d) => { r['合同跟进'] = d; },
  SCRIPT_OK: (r, d) => { r['阶段'] = '待付定金'; r['阶段更新'] = d; },
  REVISE: (r) => { r['修改意见'] = ''; },
  DEPOSIT_SENT: () => {},
  VIDEO_OK: (r, d) => { r['阶段'] = '待发布'; r['阶段更新'] = d; },
  FINAL_INVOICE: (r, d) => { r['阶段'] = '尾款待付'; r['阶段更新'] = d; },
  FINAL_SENT: () => {},
};

export function markSent(rows, handle, id, now = today(), threadId = '') {
  const r = findRow(rows, handle);
  if (!r) return { ok: false, reason: `表里没有 ${handle}` };
  if (!SENT_EFFECTS[id]) return { ok: false, reason: `不认识模板 ${id}` };
  if (logged(r, id) && !['REVISE', 'ASK_RATE'].includes(id)) return { ok: false, reason: `${handle} 的 ${id} 已记过发送,不重复记` };
  SENT_EFFECTS[id](r, now);
  if ((r['草稿'] || '').startsWith(id + ' ')) r['草稿'] = '';
  if (threadId) r['Gmail线程'] = threadId;
  r['邮件记录'] = [r['邮件记录'], `${id} ${now}`].filter(Boolean).join('; ');
  return { ok: true };
}

/** 草稿被人删了/不发了:清掉草稿标记,下次重新起草。 */
export function clearDraft(rows, handle) {
  const r = findRow(rows, handle);
  if (!r) return { ok: false, reason: `表里没有 ${handle}` };
  r['草稿'] = '';
  return { ok: true };
}

/** 锁价:只有用户说了才调。price 可选(KOL手动/超上限等由用户定价)。
 *  at:从中途接手(前面在别处谈好了/合同已签/视频已过…),直接落到那个阶段,前面的步骤不走。 */
export const ENTRY_STAGES = ['待发合同', '合同已发', '已签约', '脚本审核', '待付定金', '定金已付', '成片审核', '待发布', '已发布', '尾款待付'];
export function lock(rows, handle, price, now = today(), at) {
  const r = findRow(rows, handle);
  if (!r) return { ok: false, reason: `表里没有 ${handle}` };
  if (r['阶段']) return { ok: false, reason: `${handle} 已经在履约阶段(${r['阶段']})` };
  if (at && !ENTRY_STAGES.includes(at)) return { ok: false, reason: `不能从「${at}」接手,可选: ${ENTRY_STAGES.join(' / ')}` };
  const p = price != null ? Number(price) : Number(String(r['成交价']).replace(/[$,]/g, ''));
  if (!(p > 0)) return { ok: false, reason: '没有成交价,锁价要带价格: lock @handle 250' };
  if (price == null && r['状态'] !== '成交待锁') return { ok: false, reason: `${handle} 状态是 ${r['状态']},不是成交待锁;如果是你定的价请带上价格` };
  r['成交价'] = p; r['状态'] = '已成交'; r['阶段'] = at || '待发合同'; r['阶段更新'] = now;
  // 中途接手:之前在别处聊的来信都已经谈完了,不当成新回信去叫 Claude
  if (at && !r['已处理来信']) r['已处理来信'] = new Date().toISOString();
  if (at && ENTRY_STAGES.indexOf(at) >= ENTRY_STAGES.indexOf('定金已付')) {
    // 中途接手时定金早就付了,不再补发"定金已付"通知
    if (!r['定金已付']) r['定金已付'] = '接手前已付';
    r['邮件记录'] = [r['邮件记录'], `DEPOSIT_SENT ${now}(接手前)`].filter(Boolean).join('; ');
  }
  return { ok: true };
}

export function moveStage(rows, handle, to, now = today()) {
  const r = findRow(rows, handle);
  if (!r) return { ok: false, reason: `表里没有 ${handle}` };
  const from = r['阶段'];
  if (!from) return { ok: false, reason: `${handle} 还没锁价,没有履约阶段` };
  if (!STAGES.includes(to)) return { ok: false, reason: `不认识阶段 ${to}` };
  const okMove = to === '暂停' || to === '取消' || from === '暂停' || (MANUAL_MOVES[from] ?? []).includes(to);
  if (!okMove) return { ok: false, reason: `${from} 不能手动跳到 ${to}(可去: ${(MANUAL_MOVES[from] ?? []).join('/') || '无,等对应动作'})` };
  r['阶段'] = to; r['阶段更新'] = now;
  return { ok: true };
}

/** 审核结论只能来自用户。pass 推进;revise 留在原阶段(打回信用 REVISE + 用户原话)。 */
export function review(rows, handle, what, verdict, { date } = {}, now = today()) {
  const r = findRow(rows, handle);
  if (!r) return { ok: false, reason: `表里没有 ${handle}` };
  const need = what === 'script' ? '脚本审核' : what === 'video' ? '成片审核' : null;
  if (!need) return { ok: false, reason: 'review 只认 script / video' };
  if (r['阶段'] !== need) return { ok: false, reason: `${handle} 不在${need}阶段(现在: ${r['阶段'] || '无'})` };
  if (verdict === 'revise') return { ok: true, revise: true };
  if (verdict !== 'pass') return { ok: false, reason: '结论只认 pass / revise' };
  r['阶段'] = what === 'script' ? '脚本已通过' : '成片已通过'; r['阶段更新'] = now;
  if (what === 'video' && date) r['发布日期'] = date;
  return { ok: true };
}

export function paid(rows, handle, which, { method } = {}, now = today()) {
  const r = findRow(rows, handle);
  if (!r) return { ok: false, reason: `表里没有 ${handle}` };
  const stamp = method ? `${now} via ${method}` : now;
  if (which === 'deposit') {
    if (r['阶段'] !== '待付定金') return { ok: false, reason: `${handle} 不在待付定金(现在: ${r['阶段'] || '无'})` };
    r['定金已付'] = stamp; r['阶段'] = '定金已付'; r['阶段更新'] = now;
    return { ok: true };
  }
  if (which === 'final') {
    if (r['阶段'] !== '尾款待付') return { ok: false, reason: `${handle} 不在尾款待付(现在: ${r['阶段'] || '无'})` };
    r['尾款已付'] = stamp; r['阶段'] = '已结清'; r['阶段更新'] = now;
    return { ok: true };
  }
  return { ok: false, reason: 'paid 只认 deposit / final' };
}

export function published(rows, handle, url, date, now = today()) {
  const r = findRow(rows, handle);
  if (!r) return { ok: false, reason: `表里没有 ${handle}` };
  if (!['待发布', '成片已通过', '成片审核', '定金已付'].includes(r['阶段'])) return { ok: false, reason: `${handle} 在 ${r['阶段'] || '无'},还不到发布` };
  if (!/^https?:\/\//.test(url || '')) return { ok: false, reason: '发布链接要是 http 开头的网址' };
  r['发布链接'] = url; r['发布日期'] = date || now; r['阶段'] = '已发布'; r['阶段更新'] = now;
  return { ok: true };
}

/** 跟进后仍没回 → 失联。 */
export function expire(rows, cfg, now = today()) {
  const out = [];
  for (const r of rows) if (dueAction(r, cfg, now).kind === 'expire') { r['状态'] = '失联'; out.push(r['账号']); }
  return out;
}

/** 还在进行中的线程:每日同步要去 Gmail 查这些人有没有新回信。 */
export function activeThreads(rows) {
  return rows.filter((r) => r['邮箱'] && (r['发送1'] || r['阶段'])
    && !CLOSED.has(r['状态']) && !['已结清', '取消'].includes(r['阶段']))
    .map((r) => {
      const dates = String(r['邮件记录'] || '').match(/\d{4}-\d{2}-\d{2}/g) ?? [];
      return { 账号: r['账号'], 邮箱: r['邮箱'], 最近联系: dates.sort().at(-1) ?? r['发送1'], 位置: r['阶段'] || r['状态'] };
    });
}

/** Claude 读完新回信后调:记为已处理。 */
export function markHandled(rows, handle) {
  const r = findRow(rows, handle);
  if (!r) return { ok: false, reason: `表里没有 ${handle}` };
  r['已处理来信'] = r['最新来信'] || new Date().toISOString();
  return { ok: true };
}

const TEMPLATE_CN = {
  FIRST: '首触', FIRST_FU: '跟进', ASK_RATE: '询价', COUNTER: '第2轮还价', OUT_OF_RANGE: '范围收尾', CLOSE_REJECTED: '礼貌收尾',
  DEAL: '成交确认+合同', CONTRACT_FU: '催合同', SCRIPT_OK: '脚本通过', REVISE: '修改意见', DEPOSIT_SENT: '定金已付通知',
  VIDEO_OK: '成片通过', FINAL_INVOICE: '尾款+invoice', FINAL_SENT: '尾款已付通知', RECALL: '返场邀请',
};
export const templateName = (id) => TEMPLATE_CN[id] ?? id;

/** 「下一步」列:一句人话。 */
export function nextStepText(row, cfg, now = today()) {
  const a = dueAction(row, cfg, now);
  if (String(row['决定结果'] || '').startsWith('⏳') && a.kind !== 'drafted') {
    return `等 Claude 把修改意见翻成英文(${cfg.claudeCooldownMinutes ?? 15} 分钟内),之后自动起草`;
  }
  switch (a.kind) {
    case 'drafted': return `👉 去 Gmail 草稿箱发送「${templateName(a.template)}」`;
    case 'stale': return `⚠️ ${a.why}`;
    case 'email': return `机器起草「${templateName(a.template)}」中`;
    case 'human': return `👉 ${a.why}`;
    case 'reply': return a.why;
    case 'wait': return a.why;
    case 'expire': return '没回信,即将标失联';
    default:
      if (row['阶段'] === '已结清') return '✅ 已结清';
      if (row['阶段'] === '暂停') return '已暂停:写「恢复 阶段」继续';
      if (row['阶段'] === '取消') return '已取消';
      return { 失联: '已失联:跟进后仍没回,不再自动联系', 已关闭: '已关闭', 跳过: '已跳过' }[row['状态']] ?? '';
  }
}
