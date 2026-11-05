/** 表的安全变更操作。agent 永远用这些命令改表,不许手编 CSV(防串列/丢引号)。 */

export function findRow(rows, handle) {
  const h = handle.replace(/^@/, '').toLowerCase();
  return rows.find((r) => (r['账号'] || '').replace(/^@/, '').toLowerCase() === h) ?? null;
}

/** 记录第 N 轮已发送。 */
export function markSent(rows, handle, round, when) {
  const r = findRow(rows, handle);
  if (!r) return { ok: false, reason: `表里没有 ${handle}` };
  const col = round === 2 ? '发送2' : '发送1';
  if (r[col]) return { ok: false, reason: `${handle} 的${col}已有记录 ${r[col]},不重复标` };
  r[col] = when;
  return { ok: true };
}

/** 记录她的回信:要价 或 回复类型(接受/拒绝),二选一至少给一个。 */
export function recordReply(rows, handle, { q, type } = {}) {
  const r = findRow(rows, handle);
  if (!r) return { ok: false, reason: `表里没有 ${handle}` };
  if (!r['发送1']) return { ok: false, reason: `${handle} 还没发过首触,不该有回信` };
  if (q == null && !type) return { ok: false, reason: '要价和回复类型至少给一个' };
  if (q != null) {
    const n = Number(q);
    if (!Number.isFinite(n) || n <= 0) return { ok: false, reason: `要价 ${q} 不是正数` };
    r['他的要价'] = n;
  }
  if (type) {
    if (!['接受', '拒绝', '还价', '问详情'].includes(type)) return { ok: false, reason: `回复类型 ${type} 不认识` };
    r['回复类型'] = type;
  }
  return { ok: true };
}

/** 已发送但还没记录回信的行(agent 该去 Gmail 搜这些人)。 */
export function pendingReplies(rows) {
  return rows.filter((r) => r['发送1'] && !r['他的要价'] && !r['回复类型'] && !r['成交价']
    && !(r['状态'] || '').startsWith('放弃') && r['状态'] !== '已关闭');
}
