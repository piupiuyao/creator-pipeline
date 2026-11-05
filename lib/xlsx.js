/** 读 Google 表导出的 .xlsx 里指定的一个 tab(CSV 导出只给第一个 tab)。零依赖,复用 docx.js 的 zip 读取。 */
import { readZip } from './docx.js';

const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&amp;/g, '&');
const colIndex = (ref) => [...ref.replace(/\d+/g, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
const textOf = (xml) => [...xml.matchAll(/<t(?: [^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unesc(m[1])).join('');

export function sheetNames(buf) {
  const files = new Map(readZip(buf).map((f) => [f.name, f.data.toString('utf8')]));
  return [...(files.get('xl/workbook.xml') ?? '').matchAll(/<sheet [^>]*name="([^"]+)"/g)].map((m) => unesc(m[1]));
}

/** 返回 [{列名: 值}],第一行当表头。 */
export function readXlsxTab(buf, tabName) {
  const files = new Map(readZip(buf).map((f) => [f.name, f.data.toString('utf8')]));
  const wb = files.get('xl/workbook.xml') ?? '';
  const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
  const sheets = [...wb.matchAll(/<sheet [^>]*>/g)].map((m) => ({ name: unesc(attr(m[0], 'name') ?? ''), rid: attr(m[0], 'r:id') }));
  const hit = tabName ? sheets.find((s) => s.name === tabName) : sheets[0];
  if (!hit) throw new Error(`xlsx 里没有 tab「${tabName}」,有: ${sheets.map((s) => s.name).join(' / ')}`);
  const rels = files.get('xl/_rels/workbook.xml.rels') ?? '';
  const target = [...rels.matchAll(/<Relationship [^>]*>/g)].map((m) => m[0]).filter((t) => attr(t, 'Id') === hit.rid).map((t) => attr(t, 'Target'))[0];
  const path = target?.startsWith('/') ? target.slice(1) : `xl/${target}`;
  const xml = files.get(path);
  if (!xml) throw new Error(`找不到 tab 数据 ${path}`);
  const shared = [...(files.get('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));
  const grid = [];
  for (const row of xml.matchAll(/<row [^>]*>([\s\S]*?)<\/row>|<row [^>]*\/>/g)) {
    const cells = [];
    for (const c of (row[1] ?? '').matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1], body = c[2] ?? '';
      const ref = attrs.match(/r="([A-Z]+\d+)"/)?.[1], type = attrs.match(/t="(\w+)"/)?.[1];
      const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let val = '';
      if (type === 's') val = shared[Number(v)] ?? '';
      else if (type === 'inlineStr') val = textOf(body);
      else if (v != null) val = unesc(v);
      if (ref) cells[colIndex(ref)] = val;
    }
    grid.push(cells);
  }
  const header = (grid.shift() ?? []).map((h) => String(h ?? '').trim());
  return grid.filter((r) => r.some((x) => x !== undefined && x !== ''))
    .map((r) => Object.fromEntries(header.map((h, k) => [h, r[k] ?? ''])));
}
