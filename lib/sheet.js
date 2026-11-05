/** 达人表读写。列固定,自控格式;备注等自由文本走引号转义。
 *  左半(账号→成交价)是找人+砍价,右半(阶段→尾款已付)是成交后的履约。 */
export const COLUMNS = [
  '账号','姓名','平台','主页','粉丝','平均播放','互动率','邮箱','地区',
  '流量价值','第1轮报价','状态','发送1','跟进1',
  '他的要价','回复类型','第2轮报价','发送2','成交价',
  '阶段','阶段更新','合同跟进','定金已付','发布链接','发布日期','尾款已付',
  '发布播放','实际CPM','提到产品',
  '草稿','邮件记录',
  '来源','备注',
];
const esc = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function toCsv(rows) {
  return [COLUMNS.join(','), ...rows.map((r) => COLUMNS.map((c) => esc(r[c])).join(','))].join('\n') + '\n';
}
export function parseCsv(text) {
  const out = []; let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); if (row.some((f) => f !== '')) out.push(row); row = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }
  if (field !== '' || row.length) { row.push(field); if (row.some((f) => f !== '')) out.push(row); }
  const header = (out.shift() ?? []).map((h) => h.replace(/^﻿/, '').trim());
  return out.map((r) => Object.fromEntries(header.map((h, k) => [h, r[k] ?? ''])));
}
