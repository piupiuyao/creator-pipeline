/**
 * KOC 砍价引擎。锚 = 公允价(起步价 + 每千播放 × 播放),他的报价只当天花板/照单带。
 *
 * 梯子:
 *   Q ≤ 公允×1.15   → 照单成交(为 $20 拉扯一轮不值)
 *   Q ≤ 公允×3      → 第1轮 公允×80%,第2轮 公允到顶,再不拢转人工
 *   Q > 公允×3      → 范围收尾信,不进砍价
 * 护栏:无播放不出价 / 买量熔断 / 太小单不谈 / 反悔抬价·法务·愤怒转人工。
 * 唯一例外:operator 手填价压过公式(人 > 公式)。
 */
import { DEFAULT_CONFIG } from './config.js';
import { fairValue, isLikelyBoughtViews, pretty } from './cpm.js';

export function decideKocCpm(i, cfg = DEFAULT_CONFIG) {
  if (i.action === 'rejected')    return { kind: 'close_rejected', reason: '他拒绝合作' };
  if (i.action === 'escalate')    return { kind: 'needs_human', reason: '消息需要人工判断,禁止自动出价' };
  if (i.action === 'raised_back') return { kind: 'needs_human', reason: '答应后反悔抬价,强制人工' };
  if (isLikelyBoughtViews(i, cfg)) return { kind: 'needs_human', reason: '买量嫌疑(播放高互动低),定价分母不可信' };
  if (i.action === 'no_substance') return { kind: 'wait', reason: '无实质进展,按兵不动' };

  // operator 手填顶价 = 显式人工授权,压过公式(唯一例外,人 > 公式)
  const value = i._operatorTarget ?? fairValue(i, cfg);
  if (value == null) return { kind: 'needs_human', reason: '缺平均播放数据,无定价依据,不自动出价' };

  if (i.action === 'accepted') {
    const agreed = i.lastCounter ?? (i.Q != null ? Math.min(i.Q, value) : null);
    return agreed == null
      ? { kind: 'needs_human', reason: '他表示接受,但线程里没有可锁定的价格' }
      : { kind: 'to_pending_deal', agreed, value, reason: `他接受 $${agreed},等人工锁价` };
  }
  if (i.action === 'no_quote' || i.Q == null) {
    return i.round === 0
      ? { kind: 'send_ask_rate', template: 'T-1', value, reason: '没报价,发索价信' }
      : { kind: 'wait', value, reason: '已在谈判中但这封没新价,等待' };
  }

  const Q = i.Q;
  // 她开价已在公允带内 → 也先砍一刀试试(操作者 2026-09-18 定):
  // round0 还她的价×80%,最坏结局是她坚持原价我们照收,一封邮件的成本。
  // 例外:砍完不足 $30 的小单不值得多这一轮,直接照单。
  if (Q <= value * cfg.acceptBandX) {
    const trim = Math.round(Q * (cfg.openerX ?? 0.8));
    if (i.round === 0 && trim >= cfg.minCounterUsd) {
      return { kind: 'send_counter', counter: pretty(trim), value, template: 'T-2',
        reason: `她要 $${Q} 已在公允 $${value} 带内,仍先砍一刀还 $${trim}(×${cfg.openerX});她坚持就按原价收` };
    }
    return { kind: 'to_pending_deal', agreed: Q, value,
      reason: `她坚持 $${Q}(公允带内),按她的价,等人工锁价` };
  }
  // 放弃线:差太远的单不进砍价;他要真按范围回来,算新报价重新进门
  if (Q > value * cfg.kocWalkGapX) {
    return { kind: 'close_out_of_range', value,
      reason: `要价 $${Q} 超公允 $${value} 的 ${cfg.kocWalkGapX} 倍,不考虑,发范围收尾信` };
  }
  if (i.round >= cfg.maxRounds) return { kind: 'needs_human', value, reason: `砍了 ${i.round} 轮未拢,转人工` };
  if (i.round === 0) {
    const counter = Math.round(value * (cfg.openerX ?? 0.8));
    // 还价都不到 $30 的单,不值得自动谈
    if (counter < cfg.minCounterUsd) {
      return { kind: 'needs_human', value, reason: `可还金额 $${counter} 低于 $${cfg.minCounterUsd},单太小不值得自动谈` };
    }
    if (counter > (cfg.maxAutoOfferUsd ?? Infinity)) {
      return { kind: 'needs_human', value, reason: `自动报价 $${counter} 超单笔上限 $${cfg.maxAutoOfferUsd},人拍板` };
    }
    return { kind: 'send_counter', counter: pretty(counter), value, template: 'T-2',
      reason: `公允 $${value}(${i.avgViews} 播放),第1轮还 $${counter}(公允×80%)` };
  }
  return { kind: 'send_counter', counter: pretty(value), value, template: 'T-3',
    reason: `第2轮给到公允 $${pretty(value)},到顶` };
}
