/**
 * 表驱动管线。
 *  computeRound1: 先手开价 —— 第1轮 = 流量价值×80%(2026-09-18 确认先手锚定,
 *  跳过「他先喊虚高价」回合)。护栏结果写进「状态」列,人审的就是这两列。
 *  computeRound2: 回信后,按他的要价定第2轮:
 *    接受            → 成交待锁(成交价=第1轮);autoLockOnAccept 时直接锁价进待发合同
 *    要价 ≤ 价值      → 成交待锁(按他的价,他比天花板便宜)
 *    价值 < 要价 ≤ 3倍 → 第2轮 = 价值,到顶
 *    要价 > 3倍       → 放弃(范围收尾信)
 */
import { DEFAULT_CONFIG } from './config.js';
import { fairValue, isLikelyBoughtViews, pretty } from './cpm.js';

const num = (v) => { const n = Number(String(v ?? '').replace(/[$,\s]/g, '')); return Number.isFinite(n) && String(v).trim() !== '' ? n : null; };

export function computeRound1(rows, cfg = DEFAULT_CONFIG) {
  for (const r of rows) {
    if (r['状态'] && !['待审核', '已通过'].includes(r['状态'])) continue; // 人标过的不动
    // 人 > 公式:已有第1轮报价的行(无论人改过还是机器算过)绝不重算,
    // 否则「审核时手改价格 → 加新人重跑 compute → 手改被冲掉」。
    if (r['第1轮报价']) continue;
    const followers = num(r['粉丝']), avgViews = num(r['平均播放']), eng = num(r['互动率']);
    if (followers == null) { r['状态'] = '缺粉丝数'; continue; }
    if (followers >= cfg.kocFollowerMax) {
      // KOL 引擎不出价,但公允价照算做参考线 —— 历史回测里 6 个 CPM 灾难单
      // ($218-$877)有 5 个是 KOL,全部发生在没有价值线盯着的人工谈判里。
      const v = fairValue({ avgViews, platform: r['平台'] }, cfg);
      if (v != null) r['流量价值'] = v;
      r['状态'] = 'KOL手动'; continue;
    }
    if (avgViews == null || avgViews <= 0) { r['状态'] = '缺播放'; continue; }
    if (isLikelyBoughtViews({ avgViews, engagementRatePct: eng }, cfg)) { r['状态'] = '买量嫌疑'; continue; }
    const value = fairValue({ avgViews, platform: r['平台'] }, cfg);
    const offer = Math.round(value * (cfg.openerX ?? 0.8));
    if (offer < cfg.minCounterUsd) { r['状态'] = '单太小'; r['流量价值'] = value; continue; }
    if (offer > cfg.maxAutoOfferUsd) { r['状态'] = '超上限待人工'; r['流量价值'] = value; continue; }
    r['流量价值'] = value;
    r['第1轮报价'] = pretty(offer);
    r['状态'] = r['审核'] === '通过' ? '已通过' : '待审核';
  }
  return rows;
}

/** 对方原样接受了我们开的价:可选直接锁价(省掉人再写一次「锁价」)。他自己报的价落在带内的,仍等人锁。 */
function acceptedOurPrice(r, cfg, price) {
  r['成交价'] = price;
  if (cfg.autoLockOnAccept && Number(price) > 0) {
    r['状态'] = '已成交'; r['阶段'] = '待发合同'; r['阶段更新'] = new Date().toLocaleDateString('sv-SE');
  } else r['状态'] = '成交待锁';
}

export function computeRound2(rows, cfg = DEFAULT_CONFIG) {
  for (const r of rows) {
    if (!r['发送1'] || r['成交价']) continue;
    // 第2轮已发之后的结局:接受 → 按第2轮价成交待锁;拒绝 → 关闭;
    // 又还价 → 两轮已尽,只标状态留给人,机器不再出价。
    if (r['第2轮报价']) {
      if (!r['发送2']) continue; // 第2轮还没发,等发送
      const reply = (r['回复类型'] || '').trim();
      if (reply === '接受') acceptedOurPrice(r, cfg, r['第2轮报价']);
      else if (reply === '拒绝') { r['状态'] = '已关闭'; }
      else if (num(r['他的要价']) != null && r['状态'] === '第2轮待审') { /* 旧要价,无新信息 */ }
      continue;
    }
    const value = num(r['流量价值']), r1 = num(r['第1轮报价']), Q = num(r['他的要价']);
    const reply = (r['回复类型'] || '').trim();
    if (!reply && Q == null) continue; // 还没回信
    if (reply === '拒绝') { r['状态'] = '已关闭'; continue; }
    if (reply === '接受') { acceptedOurPrice(r, cfg, r1); continue; }
    if (Q == null) { r['状态'] = '回信无价待人工'; continue; }
    if (value == null) { r['状态'] = '异常缺价值'; continue; }
    if (Q <= r1) {
      // 她开得比我们还低 → 也先砍一刀(×openerX)。她坚持的话,人工把成交价填她的原价。
      const trim = Math.round(Q * (cfg.openerX ?? 0.8));
      if (trim >= cfg.minCounterUsd) { r['第2轮报价'] = pretty(trim); r['状态'] = '第2轮待审-低价再砍'; continue; }
      r['成交价'] = Q; r['状态'] = '成交待锁'; continue;
    }
    // 照单带:她要的高于我们开价但仍在公允带内 → 按她的价收,省一轮拉扯
    if (Q <= value * cfg.acceptBandX) { r['成交价'] = Q; r['状态'] = '成交待锁'; continue; }
    if (Q <= value * cfg.kocWalkGapX) { r['第2轮报价'] = pretty(value); r['状态'] = '第2轮待审'; continue; }
    r['状态'] = '放弃-超3倍';
  }
  return rows;
}
