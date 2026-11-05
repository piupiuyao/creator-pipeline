import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeZip, readZip, fillDocx } from './lib/docx.js';
import { parseCsv } from './lib/sheet.js';
import { firstName, render } from './lib/templates.js';
import { dueAction } from './lib/flow.js';
import { DEFAULT_CONFIG } from './lib/config.js';
import { gate } from './lib/source.js';

const CP = join(dirname(fileURLToPath(import.meta.url)), 'cp.js');

// Word 会把 {{creator_name}} 拆进好几个 run —— 测试模板故意这么拆
function makeDocx() {
  const doc = `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:r><w:t>Creator: {{creator</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>_name}}</w:t></w:r></w:p>
<w:p><w:r><w:t>Fee: $</w:t></w:r><w:r><w:t>{{amount}} (deposit {{deposit}})</w:t></w:r></w:p>
<w:p><w:r><w:t>Plain paragraph &amp; untouched</w:t></w:r></w:p>
<w:p><w:r><w:t>Address: {{creator_address}}</w:t></w:r></w:p>
</w:body></w:document>`;
  return writeZip([
    { name: '[Content_Types].xml', data: Buffer.from('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>') },
    { name: 'word/document.xml', data: Buffer.from(doc) },
  ]);
}

test('docx:拆开的占位也能填,没值的报 missing,其他段落不动', () => {
  const res = fillDocx(makeDocx(), { creator_name: 'Sarah Kim', amount: 250, deposit: 125 });
  const xml = readZip(res.buf).find((f) => f.name === 'word/document.xml').data.toString();
  assert.match(xml, /Creator: Sarah Kim/);
  assert.match(xml, /Fee: \$250 \(deposit 125\)/);
  assert.match(xml, /Plain paragraph &amp; untouched/);
  assert.deepEqual(res.missed, ['creator_address']);
});

test('称呼:怪名字一律 there', () => {
  assert.equal(firstName({ 姓名: 'sarah kim' }), 'Sarah');
  assert.equal(firstName({ 姓名: 'nan' }), 'there');
  assert.equal(firstName({ 姓名: 'Dr. Lee' }), 'there');
  assert.equal(firstName({ 姓名: '✨Mia✨' }), 'there');
  assert.equal(firstName({ 姓名: '小美' }), 'there');
});

test('模板:配置缺产品信息就拒绝出稿', () => {
  const r = render('FIRST', { 邮箱: 'a@b.co', 第1轮报价: '200' }, DEFAULT_CONFIG);
  assert.equal(r.ok, false);
  assert.match(r.reason, /productName/);
});

test('找人闸门:去重/粉丝区间/负面词/没邮箱', () => {
  const cfg = DEFAULT_CONFIG;
  const base = { 平台: 'tiktok', 姓名: '', 互动率: '5', _n: 10, _bio: '' };
  const { kept, dropped } = gate([
    { ...base, 账号: '@old', 粉丝: 5000, 邮箱: 'x@y.co' },
    { ...base, 账号: '@big', 粉丝: 900000, 邮箱: 'b@y.co' },
    { ...base, 账号: '@coin', 粉丝: 5000, 邮箱: 'c@y.co', _bio: 'crypto signals daily' },
    { ...base, 账号: '@nomail', 粉丝: 5000, 邮箱: '' },
    { ...base, 账号: '@good', 粉丝: 5000, 邮箱: 'g@y.co' },
  ], [{ 账号: '@old', 平台: 'tiktok', 邮箱: '' }], cfg);
  assert.deepEqual(kept.map((k) => k.账号), ['@good']);
  assert.equal(Object.values(dropped).reduce((a, b) => a + b), 4);
  assert.equal('_bio' in kept[0], false);
});

test('全链路:导入 → 首触 → 跟进 → 回价 → 第2轮 → 锁价 → 合同 → 脚本 → 定金 → 成片 → 发布 → 尾款', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cp-'));
  const run = (...a) => execFileSync('node', [CP, ...a], { cwd: dir, encoding: 'utf8' });
  const fails = (...a) => { try { run(...a); return false; } catch { return true; } };
  const row = () => parseCsv(readFileSync(join(dir, 'creators.csv'), 'utf8')).find((r) => r['账号'] === '@sarah');
  run('init');
  const cfg = JSON.parse(readFileSync(join(dir, 'pipeline.config.json'), 'utf8'));
  Object.assign(cfg, { senderName: 'Alex', productName: 'Acme Notes', productUrl: 'https://acme.example',
    productPitch: 'an AI notes app for students', formats: ['One 30-60s TikTok video showing how you use it'],
    scope: 'one 30-60s TikTok video', briefBullets: ['30-60s, your usual style', 'Show the app on screen'] });
  writeFileSync(join(dir, 'pipeline.config.json'), JSON.stringify(cfg));
  writeFileSync(join(dir, 'list.csv'), '账号,姓名,平台,粉丝,平均播放,互动率,邮箱\nsarah,Sarah Kim,tiktok,20000,9000,4.2,sarah@example.com\n');
  run('import', 'list.csv');
  run('import', 'list.csv'); // 重复导入不加人
  assert.equal(parseCsv(readFileSync(join(dir, 'creators.csv'), 'utf8')).length, 1);

  run('compute');
  assert.equal(row()['第1轮报价'], '200'); // 9k 播放 → 公允 $250 → 首触 $200
  assert.ok(fails('draft', '@sarah'), '没审核通过不能起草首触');
  run('approve', '@sarah');
  const first = JSON.parse(run('draft', '@sarah'));
  assert.equal(first.template, 'FIRST');
  assert.match(first.body, /Hi Sarah,/);
  assert.match(first.body, /we can offer \$200/);
  assert.equal(/—/.test(first.body), false);
  run('drafted', '@sarah', 'FIRST');
  assert.ok(fails('drafted', '@sarah', 'FIRST'), '同一封不能重复起草');
  run('sent', '@sarah', 'FIRST');
  assert.equal(row()['状态'], '已发首触');

  // 跟进:把发送日期改到 4 天前
  const csv = join(dir, 'creators.csv');
  const d4 = new Date(Date.now() - 4 * 86_400_000).toISOString().slice(0, 10);
  writeFileSync(csv, readFileSync(csv, 'utf8').replace(row()['发送1'], d4));
  assert.equal(JSON.parse(run('draft', '@sarah')).template, 'FIRST_FU');
  run('sent', '@sarah', 'FIRST_FU');

  // 回价 $300 → 公允 $250 内的 3 倍 → 第2轮 $250 到顶
  run('record-reply', '@sarah', '--q', '300', '--type', '还价');
  run('round2');
  assert.equal(row()['状态'], '第2轮待审');
  const counter = JSON.parse(run('draft', '@sarah'));
  assert.equal(counter.template, 'COUNTER');
  assert.match(counter.body, /\$250 is the most we can do/);
  run('sent', '@sarah', 'COUNTER');
  run('record-reply', '@sarah', '--type', '接受');
  run('round2');
  assert.equal(row()['状态'], '成交待锁');
  assert.ok(fails('draft', '@sarah'), '没锁价不能出合同信');

  run('lock', '@sarah');
  assert.equal(row()['阶段'], '待发合同');
  assert.ok(fails('draft', '@sarah'), '没合同模板就拒绝');
  writeFileSync(join(dir, 'templates', 'contract.docx'), makeDocx());
  const deal = JSON.parse(run('draft', '@sarah'));
  assert.equal(deal.template, 'DEAL');
  assert.match(deal.body, /move forward at \$250/);
  assert.equal(deal.attachments.length, 1);
  assert.ok(existsSync(join(dir, deal.attachments[0].path)));
  assert.deepEqual(deal.attachments[0].missing, ['creator_address']);
  assert.match(deal.body, /the contract is attached/);
  run('sent', '@sarah', 'DEAL');
  assert.equal(row()['阶段'], '合同已发');

  assert.ok(fails('stage', '@sarah', '已发布'), '不能乱跳阶段');
  run('stage', '@sarah', '已签约');
  run('stage', '@sarah', '脚本审核');
  assert.ok(fails('draft', '@sarah', '--template', 'REVISE'), '打回必须带用户原话');
  const rev = JSON.parse(run('draft', '@sarah', '--template', 'REVISE', '--notes', 'Please show the search feature in the first 5 seconds.'));
  assert.match(rev.body, /first 5 seconds/);
  run('review', '@sarah', 'script', 'pass');
  const ok = JSON.parse(run('draft', '@sarah'));
  assert.equal(ok.template, 'SCRIPT_OK');
  assert.match(ok.body, /deposit of \$125/);
  run('sent', '@sarah', 'SCRIPT_OK');
  assert.equal(row()['阶段'], '待付定金');

  run('paid', '@sarah', 'deposit', '--method', 'PayPal');
  const dep = JSON.parse(run('draft', '@sarah'));
  assert.equal(dep.template, 'DEPOSIT_SENT');
  assert.match(dep.body, /\$125 has just been sent via PayPal/);
  run('sent', '@sarah', 'DEPOSIT_SENT');
  run('stage', '@sarah', '成片审核');
  run('review', '@sarah', 'video', 'pass', '--date', '2026-12-01');
  assert.match(JSON.parse(run('draft', '@sarah')).body, /\(2026-12-01\) works on our end/);
  run('sent', '@sarah', 'VIDEO_OK');
  run('published', '@sarah', 'https://www.tiktok.com/@sarah/video/1');
  writeFileSync(join(dir, 'templates', 'invoice.docx'), makeDocx());
  const inv = JSON.parse(run('draft', '@sarah'));
  assert.equal(inv.template, 'FINAL_INVOICE');
  assert.match(inv.body, /final payment of \$125/);
  run('sent', '@sarah', 'FINAL_INVOICE');
  run('paid', '@sarah', 'final');
  assert.equal(row()['阶段'], '已结清');
  assert.equal(dueAction(row(), cfg).kind, 'none');
  const report = run('report');
  assert.match(report, /已结清 1 单/);
});

test('跟进后再 5 天没回 → 失联', () => {
  const cfg = DEFAULT_CONFIG;
  const r = { 账号: '@x', 邮箱: 'x@y.co', 状态: '已发首触', 发送1: '2026-01-01', 跟进1: '2026-01-04' };
  assert.equal(dueAction(r, cfg, '2026-01-06').kind, 'wait');
  assert.equal(dueAction(r, cfg, '2026-01-09').kind, 'expire');
});

test('合同发出 1 天没签 → 催一次,只催一次', () => {
  const cfg = DEFAULT_CONFIG;
  const r = { 账号: '@x', 邮箱: 'x@y.co', 阶段: '合同已发', 阶段更新: '2026-01-01', 成交价: '200' };
  assert.equal(dueAction(r, cfg, '2026-01-02').template, 'CONTRACT_FU');
  assert.equal(dueAction({ ...r, 合同跟进: '2026-01-02' }, cfg, '2026-01-05').kind, 'wait');
});

test('xlsx:按 tab 名读,属性顺序不同也行,数字实体会解码', async () => {
  const { readXlsxTab, sheetNames } = await import('./lib/xlsx.js');
  const sheet = (rows) => `<worksheet><sheetData>${rows.map((r, i) => `<row r="${i + 1}">${r.map((v, k) => `<c r="${String.fromCharCode(65 + k)}${i + 1}" t="inlineStr"><is><t>${v}</t></is></c>`).join('')}</row>`).join('')}</sheetData></worksheet>`;
  const buf = writeZip([
    { name: 'xl/workbook.xml', data: Buffer.from('<workbook><sheets><sheet name="other" sheetId="1" r:id="rId1"/><sheet r:id="rId2" name="达人" sheetId="2"/></sheets></workbook>') },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Target="/xl/worksheets/sheet2.xml" Id="rId2"/></Relationships>') },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheet([['x'], ['1']])) },
    { name: 'xl/worksheets/sheet2.xml', data: Buffer.from(sheet([['账号', '状态', '备注'], ['@sarah', '&#36339;&#36807;', 'a &amp; b']])) },
  ]);
  assert.deepEqual(sheetNames(buf), ['other', '达人']);
  assert.deepEqual(readXlsxTab(buf, '达人'), [{ 账号: '@sarah', 状态: '跳过', 备注: 'a & b' }]);
});

test('中途接手:只跑合同到尾款,前面步骤不走', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cp-mid-'));
  const run = (...a) => execFileSync('node', [CP, ...a], { cwd: dir, encoding: 'utf8' });
  const fails = (...a) => { try { run(...a); return false; } catch { return true; } };
  const row = (h) => parseCsv(readFileSync(join(dir, 'creators.csv'), 'utf8')).find((r) => r['账号'] === h);
  run('init');
  // 只做履约的人:不填 formats,只填内容要求
  const cfg = JSON.parse(readFileSync(join(dir, 'pipeline.config.json'), 'utf8'));
  Object.assign(cfg, { senderName: 'Jo', productName: 'Acme', productUrl: 'https://acme.example', briefBullets: ['One 60s Reel'] });
  writeFileSync(join(dir, 'pipeline.config.json'), JSON.stringify(cfg));
  // 名单只有最少的列,没有粉丝/播放
  writeFileSync(join(dir, 'deals.csv'), '账号,姓名,平台,邮箱\nmia,Mia Chen,instagram,mia@example.com\nleo,Leo,tiktok,leo@example.com\nkai,Kai,tiktok,kai@example.com\n');
  run('import', 'deals.csv');
  assert.ok(fails('lock', '@mia'), '没价格不能锁');
  assert.ok(fails('lock', '@mia', '300', '--at', '已结清'), '不能从结清接手');

  run('lock', '@mia', '300');                       // 价格在别处谈好了 → 从发合同开始
  assert.ok(fails('draft', '@mia'), '没合同模板拒发');
  writeFileSync(join(dir, 'templates', 'contract.docx'), makeDocx());
  const deal = JSON.parse(run('draft', '@mia'));
  assert.equal(deal.template, 'DEAL');
  assert.match(deal.body, /Hi Mia,[\s\S]*\$300[\s\S]*One 60s Reel/);
  run('lock', '@leo', '200', '--at', '脚本审核');      // 合同已签、脚本刚交上来
  assert.equal(row('@leo')['阶段'], '脚本审核');
  run('review', '@leo', 'script', 'pass');
  assert.match(JSON.parse(run('draft', '@leo')).body, /deposit of \$100/);
  run('lock', '@kai', '500', '--at', '已发布'); // 视频已经发了,只剩尾款
  assert.equal(row('@kai')['定金已付'], '接手前已付');
  writeFileSync(join(dir, 'templates', 'invoice.docx'), makeDocx());
  const inv = JSON.parse(run('draft', '@kai'));
  assert.equal(inv.template, 'FINAL_INVOICE');
  assert.match(inv.body, /final payment of \$250/);
  assert.ok(fails('draft', '@mia', '--template', 'FIRST'), '只做履约的配置不能出首触');
});

test('找人闸门:卖课/代运营号默认过滤,可以放开', () => {
  const base = { 平台: 'tiktok', 姓名: '', 互动率: '5', _n: 10, 粉丝: 5000, 邮箱: 'a@b.co' };
  const c = [{ ...base, 账号: '@coach', _bio: 'Grow your page 📈 DM "START" to join my program' }];
  assert.equal(gate(c, [], DEFAULT_CONFIG).kept.length, 0);
  assert.equal(gate(c, [], { ...DEFAULT_CONFIG, sourcing: { ...DEFAULT_CONFIG.sourcing, allowSellers: true } }).kept.length, 1);
});

test('找相似:取种子共用的标签,过滤 fyp 这类通用标签', async () => {
  const { topTags } = await import('./lib/source.js');
  const tags = topTags([
    [['fyp', 'studytok', 'notetaking'], ['studytok', 'viral']],
    [['StudyTok', 'productivity'], ['notetaking']],
    [['cooking']],
  ], 3);
  assert.deepEqual(tags, ['studytok', 'notetaking', 'productivity']);
});

test('合同+brief 一起附;brief 是 PDF 原样附', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cp-brief-'));
  const run = (...a) => execFileSync('node', [CP, ...a], { cwd: dir, encoding: 'utf8' });
  run('init');
  const cfg = JSON.parse(readFileSync(join(dir, 'pipeline.config.json'), 'utf8'));
  Object.assign(cfg, { senderName: 'Jo', productName: 'Acme', productUrl: 'https://acme.example', briefBullets: ['One Reel'] });
  writeFileSync(join(dir, 'pipeline.config.json'), JSON.stringify(cfg));
  writeFileSync(join(dir, 'l.csv'), '账号,姓名,平台,邮箱\nmia,Mia,instagram,mia@example.com\n');
  run('import', 'l.csv'); run('lock', '@mia', '300');
  writeFileSync(join(dir, 'templates', 'contract.docx'), makeDocx());
  writeFileSync(join(dir, 'templates', 'brief.pdf'), '%PDF-1.4 test');
  const deal = JSON.parse(run('draft', '@mia'));
  assert.deepEqual(deal.attachments.map((a) => a.mimeType), ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/pdf']);
  assert.match(deal.body, /the contract and the creative brief are attached/);
});

test('老合作方返场:首触用返场信,不编造上次合作', () => {
  const cfg = { ...DEFAULT_CONFIG, senderName: 'Jo', productName: 'Acme', productUrl: 'https://acme.example', formats: ['One Reel'] };
  const r = render('FIRST', { 姓名: 'Shani', 邮箱: 's@x.co', 来源: '老合作', 第1轮报价: '' }, cfg);
  assert.equal(r.ok, true);
  assert.match(r.body, /You're on our creator roster/);
  assert.match(r.body, /share your current rate/);
  assert.match(r.subject, /^New Paid Collaboration/);
});

test('回签合同比对:只填了空 = 一致;改了条款 = 报出来', async () => {
  const { contractDiff } = await import('./lib/docx.js');
  const mk = (paras) => writeZip([{ name: 'word/document.xml', data: Buffer.from(`<w:document><w:body>${paras.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`) }]);
  const sent = mk(['Fee: USD 300', 'Payment within 5 days', 'Creator address: {{creator_address}}']);
  assert.deepEqual(contractDiff(sent, mk(['Fee: USD 300', 'Payment within 5 days', 'Creator address: 1 Main St'])), []);
  const d = contractDiff(sent, mk(['Fee: USD 500', 'Payment within 5 days', 'Creator address: 1 Main St']));
  assert.equal(d.length, 2);
  assert.equal(d[0].原文, 'Fee: USD 300');
  assert.equal(d[1].内容, 'Fee: USD 500');
});

test('地区/语言:简介能看出国家才判,多个国家不判', async () => {
  const { countryHint } = await import('./lib/source.js');
  assert.equal(countryHint('NYC based UGC creator'), 'US');
  assert.equal(countryHint('📍Lagos | content creator'), 'NG');
  assert.equal(countryHint('London → New York'), '');
  assert.equal(countryHint('la vida es bella'), '');
  const base = { 平台: 'tiktok', 姓名: '', 互动率: '5', _n: 10, 粉丝: 5000, 邮箱: 'a@b.co', _bio: '' };
  const g = { ...DEFAULT_CONFIG, sourcing: { ...DEFAULT_CONFIG.sourcing, excludeRegions: ['南亚'], languages: ['en'] } };
  const { kept, dropped } = gate([
    { ...base, 账号: '@in', 地区: 'IN', 邮箱: 'in@b.co' }, { ...base, 账号: '@es', 地区: '', _lang: 'es', 邮箱: 'es@b.co' },
    { ...base, 账号: '@ok', 地区: 'US', _lang: 'en', 邮箱: 'ok@b.co' }, { ...base, 账号: '@unk', 地区: '', 邮箱: 'unk@b.co' },
  ], [], g);
  assert.deepEqual(kept.map((k) => k.账号), ['@ok', '@unk']);
  assert.equal(dropped['地区不在范围'], 1);
});

test('导入的旧首触超过 21 天:不跟进,直接失联', () => {
  const r = { 账号: '@x', 邮箱: 'x@y.co', 状态: '已发首触', 发送1: '2026-01-01' };
  assert.equal(dueAction(r, DEFAULT_CONFIG, '2026-01-04').template, 'FIRST_FU');
  assert.equal(dueAction(r, DEFAULT_CONFIG, '2026-01-30').kind, 'expire');
});

// ── 表桥:用假的 Google 表 + 假 Gmail 走一遍"表里拍板 → 几分钟内起草 → 发出后回写" ──
function fakeBridge() {
  const sheet = { header: [], rows: [] }; const drafts = new Map(); const sent = []; const inbound = []; let n = 0;
  const api = {
    sheet, drafts, sent, inbound,
    cell(handle, col) { const i = sheet.header.indexOf(col); const r = sheet.rows.find((x) => x[sheet.header.indexOf('账号')] === handle); return r ? r[i] : undefined; },
    setCell(handle, col, v) { const r = sheet.rows.find((x) => x[sheet.header.indexOf('账号')] === handle); r[sheet.header.indexOf(col)] = v; },
    addRow(obj) { sheet.rows.push(sheet.header.map((h) => obj[h] ?? '')); },
    read: async () => ({ ok: true, header: sheet.header.slice(), rows: sheet.rows.map((r) => r.slice()) }),
    write: async (header, rows, clear = {}) => {
      if (!sheet.header.length) sheet.header = header.slice();
      const k = sheet.header.indexOf('账号'), d = sheet.header.indexOf('你的决定');
      for (const row of rows) {
        const key = row[header.indexOf('账号')];
        let r = sheet.rows.find((x) => x[k] === key);
        if (!r) { r = sheet.header.map(() => ''); sheet.rows.push(r); }
        header.forEach((h, c) => { if (h !== '你的决定') r[sheet.header.indexOf(h)] = row[c]; });
        if (clear[key] !== undefined && r[d] === clear[key]) r[d] = '';
      }
      return { ok: true };
    },
    draft: async (m) => { const id = 'd' + (++n); drafts.set(id, { ...m, id }); return { ok: true, draftId: id, threadId: m.threadId ?? 't' + n }; },
    status: async (items) => ({ ok: true, items: Object.fromEntries(items.map((it) => {
      const r = { draftExists: null, sent: null, inbound: null };
      if (it.draftId) { r.draftExists = drafts.has(it.draftId); if (!r.draftExists) { const s = sent.find((x) => x.draftId === it.draftId); if (s) r.sent = { threadId: s.threadId, at: new Date().toISOString() }; } }
      if (it.checkInbound) { const m = inbound.filter((x) => x.email === it.email).at(-1); if (m) r.inbound = { threadId: m.threadId, at: m.at }; }
      return [it.key, r];
    })) }),
    humanSends(handle) { const d = [...drafts.values()].find((x) => x.to === handle); drafts.delete(d.id); sent.push({ draftId: d.id, threadId: d.threadId ?? 'T-' + d.id }); return d; },
  };
  return api;
}

test('表桥全流程:表里写「通过」→ 起草;Gmail 发出 → 表里更新;回信 → 叫 Claude', async () => {
  const w = await import('./lib/watch.js');
  const flow = await import('./lib/flow.js');
  const { COLUMNS } = await import('./lib/sheet.js');
  const { recordReply } = await import('./lib/ops.js');
  const { computeRound2 } = await import('./lib/pipeline.js');
  const dir = mkdtempSync(join(tmpdir(), 'cp-bridge-'));
  const cfg = { ...DEFAULT_CONFIG, senderName: 'Jo', productName: 'Acme', productUrl: 'https://acme.example', formats: ['One TikTok video'], briefBullets: ['60s'] };
  const blank = () => Object.fromEntries(COLUMNS.map((c) => [c, '']));
  const rows = [{ ...blank(), 账号: '@sarah', 姓名: 'Sarah', 平台: 'tiktok', 粉丝: '20000', 平均播放: '9000', 互动率: '4', 邮箱: 'sarah@example.com' }];
  const b = fakeBridge();
  const row = () => rows.find((r) => r['账号'] === '@sarah');

  let s = await w.tick(rows, cfg, b, { dir });
  assert.equal(b.drafts.size, 0, '没审核不起草');
  assert.match(b.cell('@sarah', '下一步'), /等你审核/);

  b.setCell('@sarah', '你的决定', '通过');
  s = await w.tick(rows, cfg, b, { dir });
  assert.equal(b.drafts.size, 1);
  assert.equal(b.cell('@sarah', '你的决定'), '', '执行完清空');
  assert.match(b.cell('@sarah', '决定结果'), /^✓ 通过/);
  assert.match(b.cell('@sarah', '下一步'), /去 Gmail 草稿箱发送「首触」/);
  s = await w.tick(rows, cfg, b, { dir });
  assert.equal(b.drafts.size, 1, '不重复起草');

  b.humanSends('sarah@example.com');
  s = await w.tick(rows, cfg, b, { dir });
  assert.deepEqual(s.已发出.map((x) => x.template), ['FIRST']);
  assert.equal(row()['状态'], '已发首触');
  assert.match(b.cell('@sarah', '下一步'), /等回信/);
  const thread = row()['Gmail线程'];
  assert.ok(thread);

  b.inbound.push({ email: 'sarah@example.com', threadId: thread, at: new Date(Date.now() + 1000).toISOString() });
  s = await w.tick(rows, cfg, b, { dir });
  assert.deepEqual(s.needsClaude.map((x) => x.why), ['reply']);
  assert.match(b.cell('@sarah', '下一步'), /新回信/);

  // Claude 读完回信:记要价,标已处理 → 下一轮自动起草第2轮,回复在原线程
  recordReply(rows, '@sarah', { q: 300, type: '还价' }); computeRound2(rows, cfg); flow.markHandled(rows, '@sarah');
  s = await w.tick(rows, cfg, b, { dir });
  assert.deepEqual(s.新草稿.map((x) => x.template), ['COUNTER']);
  assert.equal([...b.drafts.values()].at(-1).threadId, thread);
  assert.equal(s.needsClaude.length, 0);
  b.humanSends('sarah@example.com'); await w.tick(rows, cfg, b, { dir });
  recordReply(rows, '@sarah', { type: '接受' }); computeRound2(rows, cfg);
  b.inbound.push({ email: 'sarah@example.com', threadId: thread, at: new Date(Date.now() + 2000).toISOString() });
  await w.tick(rows, cfg, b, { dir }); flow.markHandled(rows, '@sarah');

  // 表里锁价 → 没合同模板:下一步报起草失败,不发
  b.setCell('@sarah', '你的决定', '锁价');
  await w.tick(rows, cfg, b, { dir });
  assert.equal(row()['阶段'], '待发合同');
  assert.match(b.cell('@sarah', '下一步'), /起草失败.*合同模板/);
  writeFileSync(join(dir, 'templates.tmp'), '');
  execFileSync('mkdir', ['-p', join(dir, 'templates')]);
  writeFileSync(join(dir, 'templates', 'contract.docx'), makeDocx());
  s = await w.tick(rows, cfg, b, { dir });
  const deal = [...b.drafts.values()].at(-1);
  assert.equal(deal.attachments.length, 1);
  b.humanSends('sarah@example.com'); await w.tick(rows, cfg, b, { dir });
  assert.equal(row()['阶段'], '合同已发');

  // 表里一路推进:签了 → 收到脚本 → 中文打回(等 Claude 翻译) → 翻好后起草
  b.setCell('@sarah', '你的决定', '签了'); await w.tick(rows, cfg, b, { dir });
  b.setCell('@sarah', '你的决定', '收到脚本'); await w.tick(rows, cfg, b, { dir });
  b.setCell('@sarah', '你的决定', '脚本打回 开头5秒就要展示搜索');
  s = await w.tick(rows, cfg, b, { dir });
  assert.deepEqual(s.needsClaude.map((x) => x.why), ['translate']);
  assert.equal(b.cell('@sarah', '你的决定'), '脚本打回 开头5秒就要展示搜索', '没处理完不清');
  row()['修改意见'] = 'Please show the search feature in the first 5 seconds.';
  s = await w.tick(rows, cfg, b, { dir });
  assert.equal(b.cell('@sarah', '你的决定'), '');
  assert.match([...b.drafts.values()].at(-1).body, /first 5 seconds/);

  // 人把草稿删了、没发:不重复起草,等人写「重写」
  const d = [...b.drafts.values()].at(-1); b.drafts.delete(d.id);
  await w.tick(rows, cfg, b, { dir });
  assert.match(b.cell('@sarah', '下一步'), /草稿被删了/);
  const count = b.drafts.size; await w.tick(rows, cfg, b, { dir });
  assert.equal(b.drafts.size, count);
  b.setCell('@sarah', '你的决定', '重写'); await w.tick(rows, cfg, b, { dir });
  assert.equal(b.drafts.size, count + 1);

  // 看不懂的决定:写回原因,不清空
  b.setCell('@sarah', '你的决定', '帮我想想');
  await w.tick(rows, cfg, b, { dir });
  assert.match(b.cell('@sarah', '决定结果'), /^✗ 帮我想想:没看懂/);
  assert.equal(b.cell('@sarah', '你的决定'), '帮我想想');

  // 人在表里手动加一个达人 → 收进来
  b.addRow({ 账号: '@newbie', 平台: 'instagram', 邮箱: 'nb@example.com', 粉丝: '8000', 平均播放: '3000' });
  s = await w.tick(rows, cfg, b, { dir });
  assert.deepEqual(s.新加达人, ['@newbie']);
  assert.match(b.cell('@newbie', '下一步'), /等你审核/);
});
