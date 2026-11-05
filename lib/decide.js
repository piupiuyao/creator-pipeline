/**
 * KOC-only 路由(2026-09-18 定:KOL 道先不上,大达人标手动)。
 *  - 粉丝 ≥ 5万 → 「KOL 手动谈」,skill 不出价
 *  - 粉丝未知 → 不猜,转人工
 *  - KOC:CPM 流量价值锚,3 倍放弃线,全套护栏
 *  - 唯一例外:operator 手填 target 压过公式
 */
import { DEFAULT_CONFIG } from './config.js';
import { decideKocCpm } from './haggle-koc.js';

export function decide(i, cfg = DEFAULT_CONFIG) {
  if (i.followers == null) {
    return { kind: 'needs_human', lane: 'unrouted', reason: '缺粉丝数,先补数据' };
  }
  if (i.followers >= cfg.kocFollowerMax) {
    return { kind: 'needs_human', lane: 'kol-manual',
      reason: `粉丝 ${i.followers} ≥ ${cfg.kocFollowerMax},KOL 单手动谈,skill 不出价` };
  }
  if (i.target != null) {
    // 人工授权走还价梯子:第1轮 target×80%,第2轮 target 顶格
    const d = decideKocCpm({ ...i, _operatorTarget: i.target }, cfg);
    return { ...d, lane: 'koc-operator-target' };
  }
  return { ...decideKocCpm(i, cfg), lane: 'koc-cpm' };
}
