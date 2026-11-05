/**
 * 漏斗级调参器:发信批次的回复率/成交率 → 参数调整建议。
 * 动态不靠花公式,靠参数跟着结果走。只出建议,改配置永远要人点头。
 */
import { fitPricing } from './cpm.js';

const num = (v) => { const n = Number(String(v ?? '').replace(/[$,\s]/g, '')); return Number.isFinite(n) && String(v).trim() !== '' ? n : null; };

export function funnelStats(rows) {
  const sent = rows.filter((r) => r['发送1']);
  const replied = sent.filter((r) => r['他的要价'] || r['回复类型']);
  const closed = sent.filter((r) => num(r['成交价']) != null);
  const walked = sent.filter((r) => (r['状态'] || '').startsWith('放弃'));
  const ratios = closed
    .map((r) => { const c = num(r['成交价']), v = num(r['流量价值']); return c != null && v ? c / v : null; })
    .filter((x) => x != null);
  return {
    sent: sent.length, replied: replied.length, closed: closed.length, walked: walked.length,
    replyRate: sent.length ? replied.length / sent.length : null,
    closeRate: replied.length ? closed.length / replied.length : null,
    avgCloseToFair: ratios.length ? ratios.reduce((a, b) => a + b) / ratios.length : null,
  };
}

export function suggest(stats, cfg) {
  const out = [];
  if (stats.sent < 10) { out.push(`样本太小(发出 ${stats.sent} 封),先发满 10 封再调参`); return out; }
  if (stats.replyRate != null && stats.replyRate < 0.15) {
    out.push(`回复率 ${(stats.replyRate * 100).toFixed(0)}% 偏低:开价可能低于市场。先排除送达问题,`
      + `再考虑 openerX ${cfg.openerX} → ${Math.min(0.95, cfg.openerX + 0.05).toFixed(2)},或上调 kocBaseUsd`);
  }
  if (stats.closeRate != null && stats.closeRate >= 0.6 && stats.avgCloseToFair != null && stats.avgCloseToFair >= 0.95) {
    out.push(`成交率 ${(stats.closeRate * 100).toFixed(0)}% 且成交价≈公允价:几乎没人还价,大概率给高了。`
      + `建议 openerX ${cfg.openerX} → ${Math.max(0.6, cfg.openerX - 0.05).toFixed(2)}`);
  }
  if (stats.walked / stats.sent > 0.5) {
    out.push(`超过一半的单撞放弃线:公允价可能低于该品类行情。建议上调 kocPerKUsd,或 kocWalkGapX 3 → 4`);
  }
  if (!out.length) out.push('漏斗健康,不动参数');
  return out;
}

/** 用已成交行重拟合定价参数(归一到定制视频口径)。 */
export function refit(rows, cfg) {
  const pts = rows
    .filter((r) => num(r['成交价']) != null && num(r['平均播放']) != null)
    .map((r) => ({ views: num(r['平均播放']), closedUsd: num(r['成交价']),
      formatMult: cfg.platformMultipliers[(r['平台'] || '').toLowerCase()] ?? 1.0 }));
  return fitPricing(pts);
}
