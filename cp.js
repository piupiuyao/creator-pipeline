#!/usr/bin/env node
/**
 * creator-pipeline:达人全链路(找人 → 首触 → 跟进 → 砍价 → 合同 → 脚本 → 定金 → 成片 → 发布 → 尾款)。
 * 表 = 工作目录下的 creators.csv;配置 = pipeline.config.json。agent 只通过这些命令改表。
 *
 *   node cp.js init                                   建表/配置/brief/模板目录(已存在的不动)
 *   node cp.js source tiktok --q "kw1,kw2" [--go]     TikTok 搜视频反找作者(不带 --go 只报计划)
 *   node cp.js source instagram --tags "t1,t2" [--go] IG 话题反找作者
 *   node cp.js source similar --platform tiktok --seeds "@a,@b" [--go]  找和种子账号相似的人
 *   node cp.js source upfluence --platform tiktok --q "kw1,kw2" [--go] 用 Upfluence 数据库搜(自带邮箱)
 *   node cp.js import <file.csv> [--recall]           导入名单(去重);--recall = 老合作方,首触用返场信
 *   node cp.js compute                                算流量价值/第1轮报价
 *   node cp.js todo                                   每个人下一步(JSON)
 *   node cp.js draft @h [--notes "..."] [--template X] 渲染这人该发的邮件(JSON,含附件路径)
 *   node cp.js approve @h… | --all                    审核通过(可以起草首触了)
 *   node cp.js decide @h "锁价 250"                   执行一句决定(和表里「你的决定」列同样的写法)
 *   node cp.js drafted @h TEMPLATE [--draft-id X]     已建 Gmail 草稿
 *   node cp.js sent @h TEMPLATE [--thread X]          草稿已被人发出
 *   node cp.js handled @h                             新回信已读完记录
 *   node cp.js revise @h --notes "..."                记英文修改意见(脚本/成片打回)
 *   node cp.js sheet push|pull|sync                   通过表桥和 Google 表同步
 *   node cp.js watch-tick                             盯表一次:执行表里的决定、查草稿发没发、起草、回写
 *   node cp.js undraft @h                             草稿被删/作废
 *   node cp.js record-reply @h [--q 300] [--type 还价] 记回信
 *   node cp.js round2                                 回信后算第2轮
 *   node cp.js lock @h [price] [--at 阶段]             锁价(只在用户说了之后);--at 从中途接手
 *   node cp.js stage @h <阶段>                        手动推进(签约/收到脚本/收到成片…)
 *   node cp.js review @h script|video pass|revise [--date 2026-11-20]
 *   node cp.js paid @h deposit|final [--method PayPal]
 *   node cp.js published @h <链接> [日期]
 *   node cp.js expire                                 跟进后没回的标失联
 *   node cp.js active                                 进行中的线程(每日同步查 Gmail 用)
 *   node cp.js report [--save]                        日报
 *   node cp.js track [--go] [--all]                   发布后拉播放,算实际 CPM,查有没有提到产品
 *   node cp.js contract-check @h <回签.docx>          回签合同有没有被改条款
 *   node cp.js tsv                                    导出 TSV(贴进 Google Sheet)
 *   node cp.js pull <导出的.xlsx> --tab 名字          把人在 Google 表里改的列合并回来
 *   node cp.js tune                                   漏斗调参建议
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv, toCsv, COLUMNS } from './lib/sheet.js';
import { computeRound1, computeRound2 } from './lib/pipeline.js';
import { loadConfig, DEFAULT_CONFIG } from './lib/config.js';
import { recordReply, findRow } from './lib/ops.js';
import * as flow from './lib/flow.js';
import { buildReport } from './lib/report.js';

const SHEET = 'creators.csv';
const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const has = (name) => argv.includes(`--${name}`);
const BOOL_FLAGS = new Set(['--go', '--save', '--recall', '--all', '--no-draft']);
const pos = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--') && !BOOL_FLAGS.has(argv[i - 1])));
const die = (msg) => { console.error('拒绝:', msg); process.exit(1); };
const out = (x) => console.log(typeof x === 'string' ? x : JSON.stringify(x, null, 2));

if (!cmd || cmd === 'help' || cmd === '--help') {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^#!.*\n\/\*\*?\n?/, '').replace(/^ \* ?/gm, ''));
  process.exit(0);
}

if (cmd === 'init') {
  if (!existsSync(SHEET)) writeFileSync(SHEET, COLUMNS.join(',') + '\n');
  if (!existsSync('pipeline.config.json')) {
    const { sourcing, platformMultipliers, ...rest } = DEFAULT_CONFIG;
    writeFileSync('pipeline.config.json', JSON.stringify({ ...rest, sourcing, platformMultipliers }, null, 2) + '\n');
  }
  if (!existsSync('brief.md')) writeFileSync('brief.md', [
    '# Product brief (creators may ask about any of this)', '',
    '## What the product is (2-3 sentences, no hype)', '',
    '## What the video must show', '',
    '## Timeline', '',
    '## Do NOT promise',
    '- usage rights beyond the post itself',
    '- future campaigns or budgets', '',
  ].join('\n'));
  mkdirSync('templates', { recursive: true }); mkdirSync('reports', { recursive: true }); mkdirSync('out', { recursive: true });
  console.log('已创建 creators.csv、pipeline.config.json、brief.md、templates/、reports/、out/(已存在的未动)');
  console.log('合同模板放 templates/contract.docx,invoice 模板放 templates/invoice.docx(占位写法见 reference/fulfillment.md)');
  process.exit(0);
}

const cfg = loadConfig();
if (!existsSync(SHEET)) die(`当前目录没有 ${SHEET},先 node cp.js init`);
const rows = parseCsv(readFileSync(SHEET, 'utf8'));
const save = () => writeFileSync(SHEET, toCsv(rows));
const handle = pos[1];
const check = (res) => { if (!res.ok) die(res.reason); return res; };

switch (cmd) {
  case 'source': {
    const { sourceTikTok, sourceInstagram, sourceSimilar, gate, enrichEmails } = await import('./lib/source.js');
    const platform = pos[1];
    const list = (s) => (s || '').split(',').map((x) => x.trim()).filter(Boolean);
    const g = cfg.sourcing;
    if (platform === 'tiktok') {
      const queries = list(flag('q')); if (!queries.length) die('要给关键词: --q "kw1,kw2"');
      const per = Number(flag('per') ?? 40), maxP = Number(flag('max') ?? 60);
      const est = queries.length * per * 0.003 + maxP * 0.03;
      if (!has('go')) { out(`计划:TikTok 搜 ${queries.length} 组词×${per} 条视频,最多拉 ${maxP} 个作者主页;粉丝 ${g.followerMin}-${g.followerMax},互动率≥${g.minEngagementPct}%,${g.requireEmail ? '必须有邮箱' : '邮箱不强制'}。预计花费 ≤ $${est.toFixed(2)}。确认后加 --go`); break; }
      const { candidates, usd } = await sourceTikTok({ queries, perQuery: per, maxProfiles: maxP, country: flag('country') ?? 'US' }, cfg, process.env.APIFY_API_KEY);
      await enrichEmails(candidates);
      const { kept, dropped } = gate(candidates, rows, cfg);
      rows.push(...kept); save();
      out({ 候选: candidates.length, 入表: kept.length, 淘汰: dropped, 花费美元: Number(usd.toFixed(2)) });
    } else if (platform === 'instagram') {
      const hashtags = list(flag('tags')).map((t) => t.replace(/^#/, '')); if (!hashtags.length) die('要给话题: --tags "t1,t2"');
      const per = Number(flag('per') ?? 100), maxP = Number(flag('max') ?? 80);
      const est = hashtags.length * per * 0.0023 + maxP * 0.0027;
      if (!has('go')) { out(`计划:IG 搜 ${hashtags.length} 个话题×${per} 帖,最多拉 ${maxP} 个主页;粉丝 ${g.followerMin}-${g.followerMax},互动率≥${g.minEngagementPct}%,${g.requireEmail ? '必须有邮箱' : '邮箱不强制'}。预计花费 ≤ $${est.toFixed(2)}。确认后加 --go`); break; }
      const { candidates, usd } = await sourceInstagram({ hashtags, perTag: per, maxProfiles: maxP }, cfg, process.env.APIFY_API_KEY);
      await enrichEmails(candidates);
      const { kept, dropped } = gate(candidates, rows, cfg);
      rows.push(...kept); save();
      out({ 候选: candidates.length, 入表: kept.length, 淘汰: dropped, 花费美元: Number(usd.toFixed(2)) });
    } else if (platform === 'similar') {
      const seeds = list(flag('seeds')); const plat = flag('platform');
      if (!seeds.length || !['tiktok', 'instagram'].includes(plat)) die('用法: source similar --platform tiktok|instagram --seeds "@a,@b,@c"');
      const nTags = Number(flag('tags') ?? 5), per = Number(flag('per') ?? 30), maxP = Number(flag('max') ?? 60);
      const est = plat === 'tiktok' ? seeds.length * 0.05 + nTags * per * 0.003 + maxP * 0.03 : seeds.length * 0.003 + nTags * per * 0.0023 + maxP * 0.0027;
      if (!has('go')) { out(`计划:找和 ${seeds.join(' ')} 相似的 ${plat} 达人。先看种子近期作品取共用的 ${nTags} 个话题标签,每个标签搜 ${per} 条,最多拉 ${maxP} 个作者主页;粉丝 ${g.followerMin}-${g.followerMax},互动率≥${g.minEngagementPct}%。预计花费 ≤ $${est.toFixed(2)}。确认后加 --go`); break; }
      const { candidates, usd, tags, seedFollowers } = await sourceSimilar({ platform: plat, seeds, tags: nTags, per, maxProfiles: maxP, country: flag('country') ?? 'US' }, cfg, process.env.APIFY_API_KEY);
      await enrichEmails(candidates);
      const { kept, dropped } = gate(candidates, rows, cfg);
      rows.push(...kept); save();
      out({ 种子标签: tags.map((t) => '#' + t), 种子粉丝范围: seedFollowers, 候选: candidates.length, 入表: kept.length, 淘汰: dropped, 花费美元: Number(usd.toFixed(2)) });
    } else if (platform === 'upfluence') {
      const up = await import('./lib/source-upfluence.js');
      const { profileRejectReason } = await import('./lib/source.js');
      const keywords = list(flag('q')); const plat = flag('platform');
      if (!keywords.length || !['tiktok', 'instagram', 'youtube'].includes(plat)) die('用法: source upfluence --platform tiktok|instagram|youtube --q "kw1,kw2" [--pages 1] [--max 30]');
      const pages = Number(flag('pages') ?? 1), maxP = Number(flag('max') ?? 30);
      const token = await up.upfluenceToken();
      if (!has('go')) {
        const credits = await up.upfluenceCredits(token);
        out(`计划:Upfluence 在 ${plat} 搜 ${keywords.length} 个词×${pages} 页(每页 50 人,约 ${keywords.length * pages * 2} 点),列表先免费粗筛(粉丝 ${g.followerMin}-${g.followerMax}/简介/地区${g.requireEmail ? '/有邮箱' : ''}),再对最多 ${maxP} 人拉详情(约 ${maxP * 200} 点)。${credits != null ? `剩余额度: ${credits}。` : ''}确认后加 --go`);
        break;
      }
      const basics = await up.upfluenceMatches({ keywords, platform: plat, followerMin: g.followerMin, followerMax: g.followerMax, pages }, token);
      const pre = {}; const passed = [];
      for (const b of basics) {
        const why = (g.requireEmail && b.has_email === false) ? '没有公开邮箱'
          : profileRejectReason({ bio: b.description, name: b.name, country: String(b.country || '').toUpperCase(), lang: b.lang }, cfg);
        if (why) pre[why] = (pre[why] ?? 0) + 1; else passed.push(b);
      }
      const candidates = [];
      for (const b of passed.slice(0, maxP)) { const c = await up.upfluenceDetail(b, plat, token); if (c) candidates.push(c); }
      await enrichEmails(candidates);
      const { kept, dropped } = gate(candidates, rows, cfg);
      rows.push(...kept); save();
      out({ 搜到: basics.length, 粗筛淘汰: pre, 拉详情: Math.min(passed.length, maxP), 入表: kept.length, 详情后淘汰: dropped, 约用额度: keywords.length * pages * 2 + Math.min(passed.length, maxP) * 200 });
    } else die('source 只支持 tiktok / instagram / similar / upfluence');
    break;
  }
  case 'import': {
    const { gate } = await import('./lib/source.js');
    const file = pos[1]; if (!file) die('import <file.csv>');
    const incoming = parseCsv(readFileSync(file, 'utf8')).map((r) => ({
      ...Object.fromEntries(COLUMNS.map((c) => [c, r[c] ?? ''])),
      账号: (r['账号'] || '').startsWith('@') ? r['账号'] : '@' + (r['账号'] || ''),
      平台: (r['平台'] || '').toLowerCase(), _bio: '', _n: 99,
      ...(has('recall') ? { 来源: `老合作${r['来源'] ? ':' + r['来源'] : ''}` } : {}),
    })).filter((r) => r['账号'] !== '@');
    const { kept, dropped } = gate(incoming, rows, { ...cfg, sourcing: { ...cfg.sourcing, requireEmail: false, minEngagementPct: 0, followerMin: 0, followerMax: Infinity, allowSellers: true } });
    rows.push(...kept); save();
    out({ 导入: kept.length, 跳过: dropped });
    break;
  }
  case 'compute': computeRound1(rows, cfg); save(); break;
  case 'round2': computeRound2(rows, cfg); save(); break;
  case 'todo': {
    const now = flow.today();
    out(rows.map((r) => ({ 账号: r['账号'], 邮箱: r['邮箱'], ...flow.dueAction(r, cfg, now) })).filter((a) => a.kind !== 'none'));
    break;
  }
  case 'draft': {
    const r = findRow(rows, handle || ''); if (!r) die(`表里没有 ${handle}`);
    const { composeDraft } = await import('./lib/compose.js');
    out(check(composeDraft(r, cfg, { template: flag('template'), notes: flag('notes') })));
    break;
  }
  case 'drafted': check(flow.markDrafted(rows, handle || '', pos[2], flow.today(), cfg, flag('draft-id') ?? '')); save(); console.log('已记录草稿'); break;
  case 'sent': check(flow.markSent(rows, handle || '', pos[2], flow.today(), flag('thread') ?? '')); save(); console.log('已记录发送'); break;
  case 'approve': {
    const { applyDecision } = await import('./lib/decisions.js');
    const targets = has('all') ? rows.filter((x) => x['状态'] === '待审核' && !x['发送1'] && x['审核'] !== '通过').map((x) => x['账号']) : pos.slice(1);
    if (!targets.length) die('approve @h1 @h2 … 或 approve --all(全部待审核的)');
    for (const h of targets) { const x = applyDecision(rows, h, '通过', cfg); console.log(`${h}: ${x.msg}`); }
    save(); break;
  }
  case 'decide': {
    // 和在表里「你的决定」写一句话效果一样: decide @h "锁价 250"
    const { applyDecision } = await import('./lib/decisions.js');
    const x = applyDecision(rows, handle || '', pos.slice(2).join(' '), cfg);
    if (!x.ok) die(x.msg); save(); console.log(x.msg); break;
  }
  case 'revise': {
    // Claude 把中文修改意见翻成英文后调: revise @h --notes "..."
    const r = findRow(rows, handle || ''); if (!r) die(`表里没有 ${handle}`);
    if (!['脚本审核', '成片审核'].includes(r['阶段'])) die(`${handle} 不在脚本/成片审核阶段`);
    const notes = String(flag('notes') ?? '').trim(); if (!notes) die('要 --notes "英文修改意见"');
    if (/[\u2014]/.test(notes)) die('修改意见里不能有 em dash');
    r['修改意见'] = notes; save(); console.log('已记录修改意见,下一步起草 REVISE'); break;
  }
  case 'handled': check(flow.markHandled(rows, handle || '')); save(); console.log('已标记来信处理完'); break;
  case 'undraft': check(flow.clearDraft(rows, handle || '')); save(); console.log('已清除草稿标记'); break;
  case 'record-reply': {
    const opts = {}; if (flag('q') != null) opts.q = flag('q'); if (flag('type')) opts.type = flag('type');
    check(recordReply(rows, handle || '', opts)); save(); console.log('已记录'); break;
  }
  case 'lock': {
    check(flow.lock(rows, handle || '', pos[2] != null ? Number(pos[2]) : undefined, flow.today(), flag('at')));
    save();
    const a = flow.dueAction(findRow(rows, handle), cfg);
    console.log(`已锁价,现在在「${findRow(rows, handle)['阶段']}」,下一步: ${a.template ?? a.why ?? '无'}`);
    break;
  }
  case 'stage': check(flow.moveStage(rows, handle || '', pos[2])); save(); console.log('已更新阶段'); break;
  case 'review': {
    const res = check(flow.review(rows, handle || '', pos[2], pos[3], { date: flag('date') }));
    save();
    console.log(res.revise ? `打回:用 node cp.js draft ${handle} --template REVISE --notes "用户的原话"` : '已通过,下一步邮件见 todo');
    break;
  }
  case 'paid': check(flow.paid(rows, handle || '', pos[2], { method: flag('method') })); save(); console.log('已记录付款'); break;
  case 'published': check(flow.published(rows, handle || '', pos[2], pos[3])); save(); console.log('已记录发布,下一步:尾款+invoice'); break;
  case 'expire': { const n = flow.expire(rows, cfg); save(); out({ 标失联: n }); break; }
  case 'active': out(flow.activeThreads(rows)); break;
  case 'report': {
    const md = buildReport(rows, cfg);
    if (has('save')) { mkdirSync('reports', { recursive: true }); const p = join('reports', `${flow.today()}.md`); writeFileSync(p, md); console.error(`已存 ${p}`); }
    console.log(md);
    break;
  }
  case 'track': {
    // 发布后拉播放/点赞/评论,算实际 CPM,检查文案有没有提到产品
    const { apifyRun } = await import('./lib/source.js');
    const due = rows.filter((x) => /^https?:/.test(x['发布链接'] || '') && (has('all') || !x['发布播放']));
    if (!due.length) { console.log('没有要追踪的发布链接'); break; }
    if (!has('go')) { out(`计划:追踪 ${due.length} 条发布(${due.map((x) => x['账号']).join(' ')}),预计花费 ≤ $${(due.length * 0.01).toFixed(2)}。确认后加 --go`); break; }
    const tok = process.env.APIFY_API_KEY, stats = new Map();
    const tt = due.filter((x) => /tiktok\.com/.test(x['发布链接'])), ig = due.filter((x) => /instagram\.com/.test(x['发布链接']));
    if (tt.length) for (const v of (await apifyRun('clockworks~tiktok-scraper', { postURLs: tt.map((x) => x['发布链接']), shouldDownloadVideos: false, shouldDownloadCovers: false }, tok)).items) {
      const hit = tt.find((x) => x['发布链接'].includes(String(v.id))) ?? (tt.length === 1 ? tt[0] : null); // 短链里没有视频 id
      if (hit) stats.set(hit, { views: v.playCount, text: v.text });
    }
    if (ig.length) for (const p of (await apifyRun('apify~instagram-scraper', { directUrls: ig.map((x) => x['发布链接']), resultsType: 'posts', resultsLimit: 1 }, tok)).items) {
      const hit = ig.find((x) => p.shortCode && x['发布链接'].includes(p.shortCode)) ?? (ig.length === 1 ? ig[0] : null);
      if (hit) stats.set(hit, { views: p.videoPlayCount ?? p.videoViewCount ?? null, text: p.caption });
    }
    const terms = [cfg.productName, (cfg.productUrl || '').replace(/^https?:\/\/(www\.)?/, '').split(/[/.]/)[0]].filter((t) => t && t.length > 2).map((t) => t.toLowerCase());
    const report = [];
    for (const x of due) {
      const st = stats.get(x);
      if (!st) { report.push({ 账号: x['账号'], 结果: '没抓到(链接失效或私密)' }); continue; }
      const price = Number(String(x['成交价']).replace(/[$,]/g, ''));
      x['发布播放'] = st.views ?? '';
      x['实际CPM'] = st.views > 0 && price > 0 ? (price / (st.views / 1000)).toFixed(2) : '';
      x['提到产品'] = terms.length ? (terms.some((t) => String(st.text || '').toLowerCase().includes(t)) ? '是' : '否') : '';
      report.push({ 账号: x['账号'], 播放: x['发布播放'], 实际CPM: x['实际CPM'], 提到产品: x['提到产品'] });
    }
    save(); out(report);
    break;
  }
  case 'contract-check': {
    // 回签合同和我们发出的比对。用法: contract-check @h <对方发回的.docx>
    const { contractDiff } = await import('./lib/docx.js');
    const r = findRow(rows, handle || ''); if (!r) die(`表里没有 ${handle}`);
    const sent = join('out', `${r['账号'].replace(/^@/, '')}-contract.docx`);
    if (!existsSync(sent)) die(`找不到我们发出的合同 ${sent}`);
    if (!pos[2] || !existsSync(pos[2])) die('要给对方发回的 .docx 路径(PDF 请人工核对)');
    const diff = contractDiff(readFileSync(sent), readFileSync(pos[2]));
    out(diff.length ? { 结论: `有 ${diff.length} 处和我们发出的不一样,签约前要你看`, 明细: diff } : { 结论: '条款和我们发出的一致(只填了留给对方的空)' });
    break;
  }
  case 'watch-tick':
  case 'sheet': {
    const { bridgeFrom } = await import('./lib/bridge.js');
    const w = await import('./lib/watch.js');
    const bridge = bridgeFrom(cfg);
    if (!bridge) die('没配表桥:pipeline.config.json 里要有 sheetBridgeUrl / sheetBridgeToken / googleSheetTab(见 reference/sheet-bridge.md)');
    const sub = cmd === 'watch-tick' ? 'sync' : pos[1];
    if (sub === 'push') { await w.pushSheet(rows, cfg, bridge); save(); console.log('已写回 Google 表'); break; }
    if (sub === 'pull') { const x = await w.pullSheet(rows, cfg, bridge); await w.pushSheet(rows, cfg, bridge, x.clear); save(); out(x); break; }
    if (sub !== 'sync') die('sheet push | pull | sync');
    const summary = await w.tick(rows, cfg, bridge, { draft: !has('no-draft') });
    save();
    out(summary);
    if (summary.needsClaude.length) process.exitCode = 10; // 盯表脚本看到 10 就叫 Claude 来读回信/翻译
    break;
  }
  case 'tsv': console.log([COLUMNS, ...rows.map((r) => COLUMNS.map((c) => String(r[c] ?? '').replace(/[\t\n]/g, ' ')))].map((x) => x.join('\t')).join('\n')); break;
  case 'pull': {
    const file = pos[1]; if (!file) die('pull <google表导出的.xlsx|.csv> [--tab 名字]');
    const theirs = file.endsWith('.xlsx')
      ? (await import('./lib/xlsx.js')).readXlsxTab(readFileSync(file), flag('tab'))
      : parseCsv(readFileSync(file, 'utf8'));
    const changes = [];
    for (const t of theirs) {
      const r = findRow(rows, t['账号'] || ''); if (!r) continue;
      if (t['备注'] !== undefined && t['备注'] !== r['备注']) { r['备注'] = t['备注']; changes.push(`${r['账号']} 备注`); }
      if (t['状态'] === '跳过' && r['状态'] !== '跳过' && !r['发送1']) { r['状态'] = '跳过'; r['草稿'] = ''; changes.push(`${r['账号']} 跳过`); }
      if (!r['发送1'] && t['第1轮报价'] && t['第1轮报价'] !== r['第1轮报价']) { r['第1轮报价'] = t['第1轮报价']; changes.push(`${r['账号']} 第1轮报价→${t['第1轮报价']}`); }
    }
    save(); out({ 合并: changes });
    break;
  }
  case 'tune': {
    const { funnelStats, suggest, refit } = await import('./lib/tune.js');
    const stats = funnelStats(rows);
    console.log('漏斗:', stats);
    for (const line of suggest(stats, cfg)) console.log('建议:', line);
    const fit = refit(rows, cfg);
    console.log(fit.ok ? `重拟合(${fit.n} 单): kocBaseUsd ${cfg.kocBaseUsd} → ${fit.base}, kocPerKUsd ${cfg.kocPerKUsd} → ${fit.perK}(要人确认后写入配置)` : `重拟合: ${fit.reason}`);
    break;
  }
  default: die(`不认识的命令 ${cmd},node cp.js help 看用法`);
}
