/**
 * 合同/invoice 填充:把 .docx 模板里的 {{token}} 换成这一单的真实值。零依赖(Node 自带 zlib)。
 * Word 常把 {{creator_name}} 拆成好几个 run,所以按段落拼字后再替换:
 * 含占位的段落,整段文字写进第一个 <w:t>,其余清空(该段内混排格式会统一成第一段的样式)。
 */
import { inflateRawSync, deflateRawSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

export function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('不是有效的 .docx(zip)文件');
  const count = buf.readUInt16LE(eocd + 10); let p = buf.readUInt32LE(eocd + 16);
  const files = [];
  for (let k = 0; k < count; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('zip 目录损坏');
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const off = buf.readUInt32LE(p + 42), name = buf.toString('utf8', p + 46, p + 46 + nlen);
    const lnlen = buf.readUInt16LE(off + 26), lelen = buf.readUInt16LE(off + 28);
    const raw = buf.subarray(off + 30 + lnlen + lelen, off + 30 + lnlen + lelen + csize);
    files.push({ name, data: method === 8 ? inflateRawSync(raw) : Buffer.from(raw) });
    p += 46 + nlen + elen + clen;
  }
  return files;
}

export function writeZip(files) {
  const locals = [], centrals = []; let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8'), comp = deflateRawSync(f.data), crc = crc32(f.data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(f.data.length, 22); lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(f.data.length, 24); ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    locals.push(lh, name, comp); centrals.push(ch, name);
    offset += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const xmlUnesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** 替换一个 xml 部件里的占位;返回 { xml, applied:Set, missed:Set }。 */
export function fillXml(xml, values) {
  const applied = new Set(), missed = new Set();
  const out = xml.replace(/<w:p[ >][\s\S]*?<\/w:p>/g, (para) => {
    const texts = [...para.matchAll(/<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>/g)];
    if (!texts.length) return para;
    const joined = texts.map((m) => xmlUnesc(m[1])).join('');
    if (!/\{\{\s*[\w.]+\s*\}\}/.test(joined)) return para;
    const filled = joined.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (all, key) => {
      if (values[key] == null || values[key] === '') { missed.add(key); return all; }
      applied.add(key); return String(values[key]);
    });
    let k = 0;
    return para.replace(/<w:t(?: [^>]*)?>[\s\S]*?<\/w:t>/g, () => (k++ === 0 ? `<w:t xml:space="preserve">${xmlEsc(filled)}</w:t>` : '<w:t></w:t>'));
  });
  return { xml: out, applied, missed };
}

/** 填整个 docx(正文+页眉页脚)。 */
export function fillDocx(buf, values) {
  const files = readZip(buf), applied = new Set(), missed = new Set();
  for (const f of files) {
    if (!/^word\/(document|header\d*|footer\d*)\.xml$/.test(f.name)) continue;
    const r = fillXml(f.data.toString('utf8'), values);
    f.data = Buffer.from(r.xml, 'utf8');
    r.applied.forEach((x) => applied.add(x)); r.missed.forEach((x) => missed.add(x));
  }
  for (const x of applied) missed.delete(x);
  return { buf: writeZip(files), applied: [...applied], missed: [...missed] };
}

/** 取 docx 正文段落文字(合同回签比对用)。 */
export function docxParagraphs(buf) {
  const doc = readZip(buf).find((f) => f.name === 'word/document.xml');
  if (!doc) throw new Error('docx 里没有正文');
  return [...doc.data.toString('utf8').matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)]
    .map((m) => [...m[0].matchAll(/<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>/g)].map((t) => xmlUnesc(t[1])).join('').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/** 回签合同 vs 我们发出去的:列出被改/删/加的段落。我们发出时还空着的 {{占位}} 段,只比占位前面的文字(那是给对方填的)。 */
export function contractDiff(sentBuf, returnedBuf) {
  const sent = docxParagraphs(sentBuf), back = docxParagraphs(returnedBuf);
  const backSet = new Set(back);
  const prefixOf = (p) => p.split('{{')[0].trim();
  const changed = [];
  for (const p of sent) {
    if (p.includes('{{')) { const pre = prefixOf(p); if (pre && !back.some((b) => b.startsWith(pre))) changed.push({ 类型: '被删或被改', 原文: p }); continue; }
    if (!backSet.has(p)) changed.push({ 类型: '被删或被改', 原文: p });
  }
  const sentSet = new Set(sent), prefixes = sent.filter((p) => p.includes('{{')).map(prefixOf).filter(Boolean);
  for (const b of back) if (!sentSet.has(b) && !prefixes.some((pre) => b.startsWith(pre))) changed.push({ 类型: '对方新增或改写', 内容: b });
  return changed;
}
