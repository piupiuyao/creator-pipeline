/**
 * KOL 道:平台版 V2 砍价决策原样移植(2026-07-09 design-locked)。
 * 锚是他的报价+人给的授权价。大达人有行情,CPM 估不准(30单回测命中37%),
 * 所以这条道 CPM 只做买量诊断,不定价。
 */
import { DEFAULT_CONFIG } from './config.js';

export function decideKolV2(i, cfg = DEFAULT_CONFIG) {
  if (i.action === 'rejected') return { kind: 'close_rejected', reason: '他拒绝合作' };
  if (i.action === 'escalate') return { kind: 'needs_human', reason: '消息需要人工判断,禁止自动出价' };
  if (i.action === 'raised_back') return { kind: 'needs_human', reason: '答应后反悔抬价,强制人工' };
  if (i.boughtViewsRisk) return { kind: 'needs_human', reason: '买量风险,禁止自动出价' };
  if (i.action === 'no_substance') return { kind: 'wait', reason: '无实质进展,按兵不动' };
  if (i.action === 'accepted') {
    if (i.round > 0 && i.lastCounter == null) {
      return { kind: 'needs_human', reason: '他表示接受,但已发送还价的权威金额缺失' };
    }
    const agreed = i.lastCounter ?? i.Q;
    return agreed == null
      ? { kind: 'needs_human', reason: '他表示接受,但线程里没有可锁定的价格' }
      : { kind: 'to_pending_deal', agreed, reason: `他接受 $${agreed},等人工锁价` };
  }
  if (i.action === 'no_quote' || i.Q == null) {
    return i.round === 0
      ? { kind: 'send_ask_rate', template: 'T-1', reason: '没报价,发索价信' }
      : { kind: 'wait', reason: '已在谈判中但这封没新价,等待' };
  }
  const Q = i.Q;
  const ladder = (ceiling, label) => {
    if (Q <= ceiling) return { kind: 'to_pending_deal', agreed: Q, reason: `他要 $${Q} ≤ ${label} $${ceiling},等人工锁价` };
    if (i.round >= cfg.maxRounds) return { kind: 'needs_human', reason: `砍了 ${i.round} 轮未拢,转人工` };
    const counter = i.round === 0 ? Math.round(ceiling * 0.8) : ceiling;
    return { kind: 'send_counter', counter, template: i.round === 0 ? 'T-2' : 'T-3',
      reason: `第${i.round + 1}轮还 $${counter}(${i.round === 0 ? `${label}×80%` : `${label}顶价`})` };
  };
  if (i.target != null) {
    if (Q > i.target * cfg.insultGap) {
      return { kind: 'needs_human', reason: `要价 $${Q} 超授权 $${i.target} 的 ${cfg.insultGap} 倍,不自动还价` };
    }
    return ladder(i.target, '授权');
  }
  const autoBandMax = i.autoBandMax ?? cfg.autoBandMax;
  if (Q <= autoBandMax) {
    if (i.round === 0) {
      const counter = Math.round(Q * 0.8);
      return { kind: 'send_counter', counter, template: 'T-2', reason: `小单第1轮还 $${counter}(他报价×80%)` };
    }
    return { kind: 'to_pending_deal', agreed: Q, reason: `小单第2轮按他的价 $${Q} 给,等人工锁价` };
  }
  return { kind: 'wait_brand', reason: `他要 $${Q} > $${autoBandMax},等品牌反馈给目标价` };
}
