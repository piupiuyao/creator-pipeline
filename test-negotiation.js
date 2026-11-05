import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide } from './lib/decide.js';
import { DEFAULT_CONFIG } from './lib/config.js';
import { draftEmail } from './lib/draft.js';
import { fairValue, fitPricing } from './lib/cpm.js';

const koc = (o) => ({ platform: 'tiktok', followers: 20_000, action: 'quoted', round: 0, ...o });

// ── 定价模型:起步价 + 边际,按操作者两个实测点标定 ──
test('模型:3k播放=$100, 9k播放=$250(操作者实感)', () => {
  assert.equal(fairValue({ avgViews: 3000 }), 100);
  assert.equal(fairValue({ avgViews: 9000 }), 250);
});
test('模型:YouTube 定制视频翻倍', () => {
  assert.equal(fairValue({ avgViews: 9000, platform: 'youtube' }), 500);
  assert.equal(fairValue({ avgViews: 9000, platform: 'instagram' }), 250);
});

// ── 引擎 ──
test('9k播放要$300 → 公允$250,第1轮还$200', () => {
  const d = decide(koc({ Q: 300, avgViews: 9000 }));
  assert.equal(d.kind, 'send_counter');
  assert.equal(d.value, 250);
  assert.equal(d.counter, 200);
});
test('第2轮到顶给公允', () => {
  assert.equal(decide(koc({ Q: 300, avgViews: 9000, round: 1 })).counter, 250);
});
test('第3轮转人工', () => {
  assert.equal(decide(koc({ Q: 300, avgViews: 9000, round: 2 })).kind, 'needs_human');
});
test('公允带内也先砍一刀:她要$280 → 还$224', () => {
  const d = decide(koc({ Q: 280, avgViews: 9000 })); // 280 ≤ 287.5
  assert.equal(d.kind, 'send_counter');
  assert.equal(d.counter, 220); // 224 凑整到 220
});
test('她坚持原价(round≥1)→ 照单收', () => {
  const d = decide(koc({ Q: 280, avgViews: 9000, round: 1 }));
  assert.equal(d.kind, 'to_pending_deal');
  assert.equal(d.agreed, 280);
});
test('她要得远低于公允 → 也砍一刀', () => {
  const d = decide(koc({ Q: 200, avgViews: 50_000 })); // 公允 $1275
  assert.equal(d.kind, 'send_counter');
  assert.equal(d.counter, 160);
});
test('低价单砍完不足$30 → 不折腾,照单收', () => {
  const d = decide(koc({ Q: 35, avgViews: 2000 })); // 公允 $75,砍完 $28
  assert.equal(d.kind, 'to_pending_deal');
  assert.equal(d.agreed, 35);
});
test('3倍放弃线 → 范围收尾信', () => {
  const d = decide(koc({ Q: 1500, avgViews: 8000 })); // 公允 $225,线 $675
  assert.equal(d.kind, 'close_out_of_range');
});
test('没有播放数据 → 转人工', () => {
  assert.equal(decide(koc({ Q: 500, avgViews: null })).kind, 'needs_human');
});
test('买量嫌疑熔断', () => {
  const d = decide(koc({ Q: 500, avgViews: 60_000, engagementRatePct: 0.2 }));
  assert.match(d.reason, /买量/);
});
test('单太小不自动谈', () => {
  const d = decide(koc({ Q: 60, avgViews: 200 })); // 公允 $30,开价 $24 < $30
  assert.equal(d.kind, 'needs_human');
});
test('接受 → 按已发还价锁定', () => {
  const d = decide(koc({ action: 'accepted', avgViews: 9000, lastCounter: 200, Q: 300 }));
  assert.equal(d.agreed, 200);
});
test('大达人标 KOL 手动,不出价', () => {
  const d = decide({ followers: 300_000, Q: 2000, action: 'quoted', round: 0 });
  assert.equal(d.lane, 'kol-manual');
});
test('粉丝数未知不猜道', () => {
  assert.equal(decide({ Q: 500, avgViews: 9000, action: 'quoted', round: 0 }).lane, 'unrouted');
});
test('operator 手填价压过公式', () => {
  const d = decide(koc({ Q: 1200, avgViews: 9000, target: 700 }));
  assert.equal(d.lane, 'koc-operator-target');
  assert.equal(d.counter, 560);
});
test('参数可配:base50/perK50 时 9k 公允 $500', () => {
  const d = decide(koc({ Q: 1200, avgViews: 9000 }),
    { ...DEFAULT_CONFIG, kocBaseUsd: 50, kocPerKUsd: 50 });
  assert.equal(d.value, 500);
  assert.equal(d.counter, 400);
});
test('草稿无 em dash 且不哭穷', () => {
  const d = decide(koc({ Q: 300, avgViews: 9000 }));
  const m = draftEmail(d, { firstName: 'Sarah', senderName: 'Alex' });
  assert.ok(!m.includes('—'));
  assert.ok(!/budget is (quite )?limited/i.test(m));
  assert.match(m, /\$200/);
});

// ── 表管线 ──
import { computeRound1, computeRound2 } from './lib/pipeline.js';
const row = (o) => ({ 账号:'@t', 姓名:'T', 平台:'tiktok', 粉丝:'20000', 平均播放:'9000',
  互动率:'2.5', 邮箱:'t@x.com', 流量价值:'', 第1轮报价:'', 状态:'', 发送1:'',
  他的要价:'', 回复类型:'', 第2轮报价:'', 发送2:'', 成交价:'', 备注:'', ...o });

test('R1:先手开价 = 公允×openerX', () => {
  const [r] = computeRound1([row({})]);
  assert.equal(r['流量价值'], 250);
  assert.equal(r['第1轮报价'], 200);
});
test('R1:护栏写进状态列', () => {
  const rs = computeRound1([
    row({ 粉丝:'80000' }), row({ 平均播放:'' }),
    row({ 平均播放:'60000', 互动率:'0.2' }), row({ 平均播放:'100' }),
  ]);
  assert.deepEqual(rs.map((r) => r['状态']), ['KOL手动','缺播放','买量嫌疑','单太小']);
  // KOL 不出价但公允价照算做参考线(历史灾难单 5/6 是 KOL)
  assert.equal(rs[0]['流量价值'], 250);
  assert.equal(rs[0]['第1轮报价'], '');
});
test('R2:3倍内还价 → 第2轮给公允', () => {
  const [r] = computeRound2([row({ 流量价值:'540', 第1轮报价:'432', 发送1:'x', 他的要价:'900' })]);
  assert.equal(r['第2轮报价'], 540);
});
test('R2:她要的高于开价但在公允带内 → 按她的价成交待锁', () => {
  const [r] = computeRound2([row({ 流量价值:'540', 第1轮报价:'432', 发送1:'x', 他的要价:'600' })]);
  assert.equal(r['成交价'], 600); // 600 ≤ 540×1.15
});
test('R2:她回的比我们开价还低 → 再砍一刀', () => {
  const [r] = computeRound2([row({ 流量价值:'540', 第1轮报价:'432', 发送1:'x', 他的要价:'400' })]);
  assert.equal(r['第2轮报价'], 320); // 400×0.8,已是整数
  assert.equal(r['状态'], '第2轮待审-低价再砍');
});
test('R2:超3倍 → 放弃', () => {
  const [r] = computeRound2([row({ 流量价值:'540', 第1轮报价:'432', 发送1:'x', 他的要价:'2000' })]);
  assert.equal(r['状态'], '放弃-超3倍');
});
test('R2:接受 → 第1轮价成交待锁', () => {
  const [r] = computeRound2([row({ 流量价值:'540', 第1轮报价:'432', 发送1:'x', 回复类型:'接受' })]);
  assert.equal(r['成交价'], 432);
});
test('R2:没发过1轮的不动', () => {
  const [r] = computeRound2([row({ 流量价值:'540', 第1轮报价:'432', 他的要价:'900' })]);
  assert.equal(r['第2轮报价'], '');
});

// ── 回路②:成交重拟合 ──
test('calibrate:从成交价恢复定价参数', () => {
  const pts = [[2000,95],[4000,145],[6000,190],[8000,245],[12000,340],[20000,545]]
    .map(([v,c]) => ({ views: v, closedUsd: c }));
  const fit = fitPricing(pts);
  assert.ok(fit.ok);
  assert.ok(Math.abs(fit.base - 45) <= 10, `base=${fit.base}`);
  assert.ok(Math.abs(fit.perK - 25) <= 3, `perK=${fit.perK}`);
});
test('calibrate:样本不足拒绝拟合', () => {
  assert.equal(fitPricing([{ views: 3000, closedUsd: 100 }]).ok, false);
});

// ── 回路③:漏斗调参 ──
import { funnelStats, suggest } from './lib/tune.js';
test('tune:秒接+成交≈公允 → 建议降开价', () => {
  const rows = Array.from({ length: 12 }, () =>
    row({ 发送1:'x', 回复类型:'接受', 成交价:'250', 流量价值:'250' }));
  const s = funnelStats(rows);
  const tips = suggest(s, DEFAULT_CONFIG).join(' ');
  assert.match(tips, /给高了|openerX 0.8 → 0.75/);
});
test('tune:样本太小不调参', () => {
  const tips = suggest(funnelStats([row({ 发送1:'x' })]), DEFAULT_CONFIG).join(' ');
  assert.match(tips, /样本太小/);
});

import { pretty } from './lib/cpm.js';
test('凑整:<$100 到 5,≥$100 到 10', () => {
  assert.equal(pretty(224), 220);
  assert.equal(pretty(96), 95);
  assert.equal(pretty(48), 50);
  assert.equal(pretty(1020), 1020);
});

// ── 表操作命令 ──────────────────────────────────────────
import { markSent, recordReply, pendingReplies } from './lib/ops.js';
test('ops:mark-sent 拒绝重复标记', () => {
  const rs = [row({ 账号:'@a' })];
  assert.ok(markSent(rs, '@a', 1, '9/19').ok);
  assert.equal(rs[0]['发送1'], '9/19');
  assert.ok(!markSent(rs, '@a', 1, '9/20').ok);
});
test('ops:record-reply 校验前置和数值', () => {
  const rs = [row({ 账号:'@a' })];
  assert.ok(!recordReply(rs, '@a', { q: 300 }).ok); // 没发过首触
  rs[0]['发送1'] = '9/19';
  assert.ok(!recordReply(rs, '@a', { q: '-5' }).ok);
  assert.ok(recordReply(rs, '@a', { q: 300, type: '还价' }).ok);
  assert.equal(rs[0]['他的要价'], 300);
});
test('ops:pending 只列已发未回的', () => {
  const rs = [
    row({ 账号:'@sent', 发送1:'x' }),
    row({ 账号:'@replied', 发送1:'x', 他的要价:'200' }),
    row({ 账号:'@unsent' }),
    row({ 账号:'@walked', 发送1:'x', 状态:'放弃-超3倍' }),
  ];
  assert.deepEqual(pendingReplies(rs).map((r) => r['账号']), ['@sent']);
});

// ── 终审修复(2026-09-18)──────────────────────────────
test('修①:人手改的第1轮报价,重跑 compute 不覆盖', () => {
  const rs = [row({ 流量价值:'250', 第1轮报价:'150', 状态:'待审核' })]; // 人从200改成150
  computeRound1(rs);
  assert.equal(rs[0]['第1轮报价'], '150');
});
test('修②:超单笔上限只给参考价不出价', () => {
  const [r] = computeRound1([row({ 平均播放:'500000' })]); // 公允 $12525
  assert.equal(r['状态'], '超上限待人工');
  assert.equal(r['第1轮报价'], '');
  assert.equal(r['流量价值'], 12525);
});
test('修③:第2轮发出后她接受 → 按第2轮价成交待锁', () => {
  const [r] = computeRound2([row({ 流量价值:'540', 第1轮报价:'432', 发送1:'x',
    他的要价:'900', 第2轮报价:'540', 发送2:'x', 回复类型:'接受' })]);
  assert.equal(r['成交价'], '540');
  assert.equal(r['状态'], '成交待锁');
});
test('修③:第2轮发出后她拒绝 → 关闭', () => {
  const [r] = computeRound2([row({ 流量价值:'540', 第1轮报价:'432', 发送1:'x',
    他的要价:'900', 第2轮报价:'540', 发送2:'x', 回复类型:'拒绝' })]);
  assert.equal(r['状态'], '已关闭');
});
