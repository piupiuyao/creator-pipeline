/** 每日汇报(中文 markdown):先列要人做的事,再列进展数字。 */
import { dueAction, today } from './flow.js';

const num = (v) => { const n = Number(String(v ?? '').replace(/[$,\s]/g, '')); return Number.isFinite(n) && String(v).trim() !== '' ? n : null; };
const TEMPLATE_CN = {
  FIRST: '首触', FIRST_FU: '跟进', ASK_RATE: '询价', COUNTER: '第2轮还价', OUT_OF_RANGE: '范围收尾',
  CLOSE_REJECTED: '礼貌收尾', DEAL: '成交确认+合同', CONTRACT_FU: '催合同', SCRIPT_OK: '脚本通过',
  REVISE: '修改意见', DEPOSIT_SENT: '定金已付通知', VIDEO_OK: '成片通过', FINAL_INVOICE: '尾款+invoice',
};

export function buildReport(rows, cfg, now = today()) {
  const drafted = [], human = [], emailDue = [];
  for (const r of rows) {
    const a = dueAction(r, cfg, now);
    const who = `${r['账号']}${r['粉丝'] ? `(${r['平台'] || ''} ${r['粉丝']}粉)` : ''}`;
    if (a.kind === 'reply') human.push(`${who}:有新回信还没读(下次运行会读)`);
    else if (a.kind === 'drafted') drafted.push(`${who}:${TEMPLATE_CN[a.template] ?? a.template}`);
    else if (a.kind === 'human') human.push(`${who}:${a.why}`);
    else if (a.kind === 'email') emailDue.push(`${who}:${TEMPLATE_CN[a.template] ?? a.template}`);
  }
  const count = (pred) => rows.filter(pred).length;
  const sentWeek = count((r) => r['发送1'] && Date.parse(now) - Date.parse(r['发送1']) < 7 * 86_400_000);
  const replied = count((r) => r['发送1'] && (r['他的要价'] || r['回复类型']));
  const sent = count((r) => r['发送1']);
  const deals = rows.filter((r) => num(r['成交价']) != null && r['阶段']);
  const committed = deals.reduce((s, r) => s + num(r['成交价']), 0);
  const stageTally = {};
  for (const r of rows) { const k = r['阶段'] || r['状态'] || '(未处理)'; stageTally[k] = (stageTally[k] ?? 0) + 1; }
  const lines = [
    `# 达人外联日报 ${now}`,
    '',
    `## 需要你做的(${drafted.length + human.length} 件)`,
    '',
    drafted.length ? `**Gmail 草稿箱里等你审核发送(${drafted.length} 封)**` : '**Gmail 草稿箱:没有待审草稿**',
    ...drafted.map((s) => `- ${s}`),
    '',
    human.length ? `**等你拍板(${human.length} 件)**` : '**等你拍板:无**',
    ...human.map((s) => `- ${s}`),
    '',
    ...(emailDue.length ? [`**该起草还没起草的(${emailDue.length} 封,下次运行会自动建草稿)**`, ...emailDue.map((s) => `- ${s}`), ''] : []),
    '## 进展',
    '',
    `- 表里共 ${rows.length} 人;已发首触 ${sent} 人(近 7 天 ${sentWeek}),回信 ${replied} 人${sent ? `,回复率 ${Math.round((replied / sent) * 100)}%` : ''}`,
    `- 已成交 ${deals.length} 单,合计 $${Math.round(committed)};已结清 ${count((r) => r['阶段'] === '已结清')} 单,已发布 ${count((r) => r['发布链接'])} 条`,
    `- 失联 ${count((r) => r['状态'] === '失联')} 人,已关闭 ${count((r) => r['状态'] === '已关闭')} 人`,
    ...(() => {
      const tracked = rows.filter((r) => num(r['实际CPM']) != null);
      const untracked = rows.filter((r) => r['发布链接'] && !r['发布播放'] && Date.parse(now) - Date.parse(r['发布日期'] || now) >= 7 * 86_400_000);
      const noMention = rows.filter((r) => r['提到产品'] === '否').map((r) => r['账号']);
      const out = [];
      if (tracked.length) {
        const views = tracked.reduce((a, r) => a + (num(r['发布播放']) ?? 0), 0), spend = tracked.reduce((a, r) => a + (num(r['成交价']) ?? 0), 0);
        out.push(`- 发布效果:已追踪 ${tracked.length} 条,共 ${views} 播放,整体实际 CPM $${views ? (spend / (views / 1000)).toFixed(2) : '-'}`);
      }
      if (noMention.length) out.push(`- ⚠️ 发布内容没提到产品:${noMention.join(' ')}`);
      if (untracked.length) out.push(`- 发布满 7 天还没追踪效果:${untracked.map((r) => r['账号']).join(' ')}(跑 track)`);
      return out;
    })(),
    '',
    '## 各状态人数',
    '',
    ...Object.entries(stageTally).sort((a, b) => b[1] - a[1]).map(([k, v]) => `- ${k}:${v}`),
    '',
  ];
  return lines.join('\n');
}
