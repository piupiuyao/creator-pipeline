/**
 * 盯表任务的一轮(默认每 3 分钟跑一次,纯本机计算,不叫 Claude):
 *   1. 读表:执行「你的决定」列、合并备注、收进人在表里新加的达人
 *   2. 查 Gmail:哪些草稿已被人发出(推进状态)、哪些被删了、谁有新回信
 *   3. 重算:定价 / 第2轮 / 失联;进度变了的旧草稿从 Gmail 撤掉
 *   4. 起草:所有该发的邮件直接建进 Gmail 草稿箱(带附件、回复到原线程)
 *   5. 回写:整张表的进度、「下一步」、「决定结果」写回 Google 表
 * 只有需要读懂文字的事(新回信、中文修改意见要翻译)才返回 needsClaude,交给 Claude。
 */
import { readFileSync } from 'node:fs';
import * as flow from './flow.js';
import { applyDecision } from './decisions.js';
import { composeDraft } from './compose.js';
import { COLUMNS } from './sheet.js';
import { computeRound1, computeRound2 } from './pipeline.js';
import { findRow } from './ops.js';

const INPUT_COLS = ['姓名', '平台', '主页', '粉丝', '平均播放', '互动率', '邮箱', '地区', '来源'];
const norm = (h) => { const x = String(h || '').trim(); return x ? (x.startsWith('@') ? x : '@' + x) : ''; };
const dayEpoch = (d) => Math.floor(Date.parse(String(d).slice(0, 10)) / 1000);
const nowSec = () => Math.floor(Date.now() / 1000);

/** 1. 读表 */
export async function pullSheet(rows, cfg, bridge, now = flow.today()) {
  const { header, rows: raw } = await bridge.read();
  const sheet = raw.map((r) => Object.fromEntries(header.map((h, k) => [String(h).trim(), String(r[k] ?? '').trim()])));
  const clear = {}, results = [], needsClaude = [], imported = [];
  for (const s of sheet) {
    const handle = norm(s['账号']);
    if (!handle) continue;
    let r = findRow(rows, handle);
    if (!r) {
      // 人在表里新加的一行:收进来(去重看账号和邮箱)
      const email = (s['邮箱'] || '').toLowerCase();
      if (email && rows.some((x) => (x['邮箱'] || '').toLowerCase() === email)) continue;
      r = Object.fromEntries(COLUMNS.map((c) => [c, '']));
      r['账号'] = handle; for (const c of INPUT_COLS) r[c] = s[c] ?? '';
      r['平台'] = (r['平台'] || '').toLowerCase(); r['来源'] = r['来源'] || '表里手动加';
      rows.push(r); imported.push(handle);
    }
    if (s['备注'] !== undefined && s['备注'] !== r['备注']) r['备注'] = s['备注'];
    const text = s['你的决定'];
    if (!text) continue;
    const prev = r['决定结果'] || '';
    if (prev.startsWith(`✓ ${text}:`)) { clear[handle] = text; continue; }  // 上轮已执行,只是没清掉
    if (prev.startsWith(`✗ ${text}:`)) continue;                            // 上轮没看懂/被拒,等人改
    if (prev.startsWith(`⏳ ${text}:`)) {                                    // 等 Claude 翻译修改意见
      if (r['修改意见'] || String(r['草稿']).startsWith('REVISE')) { r['决定结果'] = `✓ ${text}:修改意见已起草`; clear[handle] = text; }
      else needsClaude.push({ handle, why: 'translate', text });
      continue;
    }
    const x = applyDecision(rows, handle, text, cfg, now);
    if (x.needsClaude) { r['决定结果'] = `⏳ ${text}:${x.msg}`; needsClaude.push({ handle, why: x.needsClaude, text }); }
    else if (x.ok) { r['决定结果'] = `✓ ${text}:${x.msg}`; clear[handle] = text; }
    else r['决定结果'] = `✗ ${text}:${x.msg}`;
    results.push({ handle, text, ...x });
  }
  return { clear, results, needsClaude, imported };
}

/** 2. 查 Gmail */
export async function syncGmail(rows, cfg, bridge, now = flow.today()) {
  const items = new Map();
  for (const r of rows) {
    const [tpl, , draftId, at] = String(r['草稿'] || '').split(' ');
    if (draftId && tpl !== '作废' && r['邮箱']) items.set(r['账号'], { key: r['账号'], email: r['邮箱'], draftId, sinceSec: Number(at) || dayEpoch(now) });
  }
  for (const t of flow.activeThreads(rows)) {
    const r = findRow(rows, t.账号);
    const since = r['已处理来信'] ? Math.floor(Date.parse(r['已处理来信']) / 1000) : dayEpoch(t.最近联系 || now);
    const it = items.get(t.账号) ?? { key: t.账号, email: t.邮箱 };
    items.set(t.账号, { ...it, checkInbound: true, sinceSec: it.draftId ? it.sinceSec : since, inboundSinceSec: since });
  }
  if (!items.size) return { sent: [], discarded: [], replies: [] };
  // 回信和草稿用不同的起点:分两类查,避免草稿时间把更早的回信挡掉
  const list = [...items.values()];
  const withDraft = list.filter((i) => i.draftId).map(({ inboundSinceSec, checkInbound, ...i }) => i);
  const inbound = list.filter((i) => i.checkInbound).map((i) => ({ key: i.key, email: i.email, checkInbound: true, sinceSec: i.inboundSinceSec }));
  const st = { ...(withDraft.length ? (await bridge.status(withDraft)).items : {}) };
  const ib = inbound.length ? (await bridge.status(inbound)).items : {};
  const sent = [], discarded = [], replies = [];
  for (const [key, s] of Object.entries(st)) {
    const r = findRow(rows, key); if (!r || s.draftExists !== false) continue;
    const tpl = r['草稿'].split(' ')[0];
    if (s.sent) { flow.markSent(rows, key, tpl, now, s.sent.threadId); sent.push({ handle: key, template: tpl }); }
    else if (flow.hasNewReply(r) || flow.dueAction(r, cfg, now).kind === 'stale') r['草稿'] = ''; // 进度变了才删的:正好,不用重写
    else { r['草稿'] = '作废 ' + r['草稿']; discarded.push({ handle: key, template: tpl }); }
  }
  for (const [key, s] of Object.entries(ib)) {
    const r = findRow(rows, key); if (!r || !s.inbound) continue;
    if (!r['Gmail线程']) r['Gmail线程'] = s.inbound.threadId;
    if (s.inbound.at > (r['已处理来信'] || '') && s.inbound.at !== r['最新来信']) { r['最新来信'] = s.inbound.at; replies.push(key); }
  }
  return { sent, discarded, replies };
}

/** 3b. 进度变了的旧草稿(如对方已签回,「催合同」还在草稿箱):从 Gmail 撤掉,清标记 */
export async function discardStale(rows, cfg, bridge, now = flow.today()) {
  const out = [];
  for (const r of rows) {
    const a = flow.dueAction(r, cfg, now);
    if (a.kind !== 'stale') continue;
    const draftId = String(r['草稿']).split(' ')[2];
    try { if (draftId) await bridge.discard(draftId); }
    catch (e) { r['决定结果'] = `⚠️ 「${flow.templateName(a.template)}」草稿已过时,自动删除失败,请在 Gmail 手动删掉(${e.message.slice(0, 60)})`; continue; }
    r['草稿'] = '';
    r['决定结果'] = `🗑 已从 Gmail 撤掉过时的「${flow.templateName(a.template)}」草稿`;
    out.push({ handle: r['账号'], template: a.template });
  }
  return out;
}

/** 4. 起草所有该发的邮件 */
export async function draftDue(rows, cfg, bridge, { dir = '.', max = 25, now = flow.today() } = {}) {
  const drafted = [], failed = {};
  for (const r of rows) {
    if (drafted.length >= max) break;
    const a = flow.dueAction(r, cfg, now);
    if (a.kind !== 'email') continue;
    const mail = composeDraft(r, cfg, { dir });
    if (!mail.ok) { failed[r['账号']] = mail.reason; continue; }
    const attachments = (mail.attachments ?? []).map((x) => ({ filename: x.filename, mimeType: x.mimeType, base64: readFileSync(x.path).toString('base64') }));
    const inThread = !['FIRST', 'RECALL'].includes(mail.template); // 首触开新线程,其余回复到原线程
    if (inThread && !r['Gmail线程']) {
      // 中途接手的人:之前在别处(同一个 Gmail)聊过,接着那个对话回,不另开新邮件
      const s = (await bridge.status([{ key: r['账号'], email: r['邮箱'], checkInbound: true, sinceSec: 0 }])).items?.[r['账号']];
      if (s?.inbound?.threadId) r['Gmail线程'] = s.inbound.threadId;
    }
    const res = await bridge.draft({ to: mail.to, subject: mail.subject, body: mail.body, threadId: inThread && r['Gmail线程'] ? r['Gmail线程'] : undefined, attachments });
    const ok = flow.markDrafted(rows, r['账号'], mail.template, now, cfg, `${res.draftId} ${nowSec()}`);
    if (!ok.ok) { failed[r['账号']] = ok.reason; continue; }
    if (mail.warning) r['决定结果'] = `⚠️ ${mail.warning}`;
    drafted.push({ handle: r['账号'], template: mail.template });
  }
  return { drafted, failed };
}

/** 5. 回写 */
export async function pushSheet(rows, cfg, bridge, clear = {}, failed = {}, now = flow.today()) {
  const values = rows.map((r) => COLUMNS.map((c) => {
    if (c === '下一步') return failed[r['账号']] ? `⚠️ 起草失败:${failed[r['账号']]}` : flow.nextStepText(r, cfg, now);
    if (c === '你的决定') return '';
    return String(r[c] ?? '');
  }));
  for (const [i, r] of rows.entries()) r['下一步'] = values[i][COLUMNS.indexOf('下一步')];
  return bridge.write(COLUMNS, values, clear);
}

export async function tick(rows, cfg, bridge, { dir = '.', draft = true, now = flow.today() } = {}) {
  const pulled = await pullSheet(rows, cfg, bridge, now);
  const gmail = await syncGmail(rows, cfg, bridge, now);
  computeRound1(rows, cfg); computeRound2(rows, cfg);
  const expired = flow.expire(rows, cfg, now);
  const stale = await discardStale(rows, cfg, bridge, now);
  const drafts = draft ? await draftDue(rows, cfg, bridge, { dir, now }) : { drafted: [], failed: {} };
  await pushSheet(rows, cfg, bridge, pulled.clear, drafts.failed, now);
  const needsClaude = [
    ...rows.filter(flow.hasNewReply).map((r) => ({ handle: r['账号'], why: 'reply' })),
    ...pulled.needsClaude,
  ];
  return { 执行决定: pulled.results.map((x) => `${x.handle} ${x.text} → ${x.ok ? '✓' : '✗'} ${x.msg}`), 新加达人: pulled.imported,
    已发出: gmail.sent, 草稿被删: gmail.discarded, 新回信: gmail.replies, 标失联: expired, 撤掉过时草稿: stale, 新草稿: drafts.drafted, 起草失败: drafts.failed, needsClaude };
}
