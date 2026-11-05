/** 公允价模型 + 买量诊断。 */
import { DEFAULT_CONFIG } from './config.js';

/** 公允价 = (起步价 + 每千播放 × 播放/1000) × 平台乘数。只做定制视频。 */
export function fairValue({ avgViews, platform }, cfg = DEFAULT_CONFIG) {
  if (avgViews == null || !(avgViews > 0)) return null;
  const mult = cfg.platformMultipliers[(platform || '').toLowerCase()] ?? 1.0;
  return Math.round((cfg.kocBaseUsd + (cfg.kocPerKUsd * avgViews) / 1000) * mult);
}

/** 出价凑整:<$100 取整到 5,≥$100 取整到 10。$224 一看是机器,$220 像人出的价。只用于我们发出的数字。 */
export function pretty(usd) {
  if (usd == null) return usd;
  return usd < 100 ? Math.round(usd / 5) * 5 : Math.round(usd / 10) * 10;
}

/** 互动率过低+播放不小 → 播放疑似买的,定价分母不可信。 */
export function isLikelyBoughtViews({ avgViews, engagementRatePct }, cfg = DEFAULT_CONFIG) {
  return (
    engagementRatePct != null
    && engagementRatePct < cfg.engagementFloorPct
    && avgViews != null
    && avgViews > cfg.engagementMinViews
  );
}

/** 最小二乘拟合 (播放/1000, 归一化成交价) → { base, perK }。成交攒够后校准用。 */
export function fitPricing(points) {
  // points: [{views, closedUsd, format}]
  const xs = [], ys = [];
  for (const p of points) {
    if (!(p.views > 0) || !(p.closedUsd > 0)) continue;
    const mult = p.formatMult ?? 1.0;
    xs.push(p.views / 1000); ys.push(p.closedUsd / mult); // 归一到定制视频口径
  }
  const n = xs.length;
  if (n < 5) return { ok: false, n, reason: '成交样本不足 5 单,继续攒' };
  const mx = xs.reduce((a, b) => a + b) / n, my = ys.reduce((a, b) => a + b) / n;
  let sxy = 0, sxx = 0;
  for (let k = 0; k < n; k++) { sxy += (xs[k] - mx) * (ys[k] - my); sxx += (xs[k] - mx) ** 2; }
  if (sxx === 0) return { ok: false, n, reason: '样本播放量无差异,拟合不出斜率' };
  const perK = sxy / sxx, base = my - perK * mx;
  if (perK <= 0 || base < 0) return { ok: false, n, reason: '拟合出负参数,样本还太乱,继续人审' };
  return { ok: true, n, base: Math.round(base), perK: Math.round(perK * 10) / 10 };
}
