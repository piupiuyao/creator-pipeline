/**
 * creator-pipeline · Google Sheet 桥(贴进团队表:扩展程序 → Apps Script)
 *
 * 让本机的 cp.js 直接读写这张表、在你的 Gmail 里建草稿、查"草稿发了没/对方回了没",
 * 不需要开浏览器。它只做这四件事:
 *   read   读一个 tab
 *   write  按「账号」更新/追加行(「你的决定」列只在值没变时清空,不会冲掉你刚写的)
 *   draft  在 Gmail 建草稿(可挂附件、可回复到原线程)。不会发送。
 *   status 查某些草稿还在不在、有没有发出、对方有没有新来信(只返回时间和线程号,不返回正文)
 *
 * 安装:见仓库 reference/sheet-bridge.md。需要在左侧「服务」里添加 Gmail API。
 */

const KEY_COL = '账号';
const DECISION_COL = '你的决定';

function setup() {
  // 第一次运行:生成访问口令。把日志里打印的口令填进本机 pipeline.config.json 的 sheetBridgeToken
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('TOKEN')) props.setProperty('TOKEN', Utilities.getUuid() + Utilities.getUuid().slice(0, 8));
  Logger.log('sheetBridgeToken = ' + props.getProperty('TOKEN'));
  GmailApp.getDrafts(); // 触发 Gmail 授权
}

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad json' }); }
  const token = PropertiesService.getScriptProperties().getProperty('TOKEN');
  if (!token || req.token !== token) return json_({ ok: false, error: 'unauthorized' });
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (req.action === 'read') return json_(read_(req.tab));
    if (req.action === 'write') return json_(write_(req));
    if (req.action === 'draft') return json_(draft_(req));
    if (req.action === 'status') return json_(status_(req.items || []));
    return json_({ ok: false, error: 'unknown action' });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function sheet_(tab) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(tab) || ss.insertSheet(tab);
}

function read_(tab) {
  const sh = sheet_(tab);
  const values = sh.getDataRange().getDisplayValues();
  if (!values.length || !values[0].join('')) return { ok: true, header: [], rows: [] };
  return { ok: true, header: values[0], rows: values.slice(1) };
}

/** 按账号 upsert,一次性写回。req: { tab, header, rows, clear: { '@h': '原决定文字' } } */
function write_(req) {
  const sh = sheet_(req.tab);
  let values = sh.getDataRange().getValues();
  let header = values.length && values[0].join('') ? values[0].map(String) : [];
  const want = req.header;
  if (!header.length) { header = want.slice(); values = [header]; }
  else { want.forEach((h) => { if (header.indexOf(h) < 0) header.push(h); }); values[0] = header; } // 缺的列补在后面,你自己加的列保留
  const width = header.length;
  values = values.map((r) => { const x = r.slice(0, width); while (x.length < width) x.push(''); return x; });
  const keyIdx = header.indexOf(KEY_COL), decIdx = header.indexOf(DECISION_COL);
  const rowOf = {};
  for (let r = 1; r < values.length; r++) { const k = String(values[r][keyIdx] || '').toLowerCase(); if (k) rowOf[k] = r; }
  const colIdx = want.map((h) => header.indexOf(h));
  let updated = 0, appended = 0, cleared = 0;
  for (const row of req.rows) {
    const key = String(row[want.indexOf(KEY_COL)] || '').toLowerCase();
    if (!key) continue;
    let r = rowOf[key];
    if (r == null) { values.push(new Array(width).fill('')); r = values.length - 1; rowOf[key] = r; appended++; } else updated++;
    for (let c = 0; c < want.length; c++) if (want[c] !== DECISION_COL) values[r][colIdx[c]] = row[c]; // 「你的决定」不在这里写
  }
  // 清掉已执行的决定:格子里还是当时读到的那句话才清
  if (decIdx >= 0 && req.clear) for (const k in req.clear) {
    const r = rowOf[k.toLowerCase()];
    if (r != null && String(values[r][decIdx]).trim() === String(req.clear[k]).trim()) { values[r][decIdx] = ''; cleared++; }
  }
  // 写之前再读一次「你的决定」列:锁住期间有人新写的,保留他写的
  const fresh = sh.getLastRow() > 1 && decIdx >= 0 ? sh.getRange(2, decIdx + 1, sh.getLastRow() - 1, 1).getValues() : [];
  fresh.forEach((v, i) => { const now = String(v[0]).trim(); if (now && values[i + 1] && now !== String(req.clear && req.clear[String(values[i + 1][keyIdx]).toLowerCase()] || '').trim()) values[i + 1][decIdx] = v[0]; });
  sh.getRange(1, 1, values.length, width).setValues(values);
  return { ok: true, updated: updated, appended: appended, cleared: cleared };
}

/** 建草稿。req: { to, subject, body, threadId?, attachments: [{ filename, mimeType, base64 }] } */
function draft_(req) {
  const boundary = 'cp_' + Utilities.getUuid().replace(/-/g, '');
  const enc = (s) => '=?UTF-8?B?' + Utilities.base64Encode(s, Utilities.Charset.UTF_8) + '?=';
  const headers = ['To: ' + req.to, 'Subject: ' + enc(req.subject), 'MIME-Version: 1.0'];
  let threadId = null;
  if (req.threadId) {
    // 回复到原线程:带上对方最后一封的 Message-ID,Gmail 才会归到同一个对话
    const th = Gmail.Users.Threads.get('me', req.threadId, { format: 'metadata', metadataHeaders: ['Message-ID', 'Subject'] });
    const last = th.messages[th.messages.length - 1];
    const mid = (last.payload.headers || []).filter((h) => h.name.toLowerCase() === 'message-id')[0];
    const subj = (th.messages[0].payload.headers || []).filter((h) => h.name.toLowerCase() === 'subject')[0];
    if (mid) headers.push('In-Reply-To: ' + mid.value, 'References: ' + mid.value);
    if (subj) headers[1] = 'Subject: ' + enc(/^re:/i.test(subj.value) ? subj.value : 'Re: ' + subj.value);
    threadId = req.threadId;
  }
  const atts = req.attachments || [];
  let mime;
  const wrap = (b64) => String(b64).replace(/\s+/g, '').replace(/.{76}/g, '$&\r\n'); // 邮件标准:base64 每行 76 字符
  const textPart = 'Content-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n' + wrap(Utilities.base64Encode(req.body, Utilities.Charset.UTF_8));
  if (!atts.length) mime = headers.join('\r\n') + '\r\n' + textPart;
  else {
    mime = headers.concat(['Content-Type: multipart/mixed; boundary="' + boundary + '"']).join('\r\n') + '\r\n\r\n'
      + '--' + boundary + '\r\n' + textPart + '\r\n'
      + atts.map((a) => '--' + boundary + '\r\nContent-Type: ' + a.mimeType + '; name="' + enc(a.filename) + '"\r\n'
        + 'Content-Disposition: attachment; filename="' + enc(a.filename) + '"\r\nContent-Transfer-Encoding: base64\r\n\r\n' + wrap(a.base64) + '\r\n').join('')
      + '--' + boundary + '--';
  }
  const message = { raw: Utilities.base64EncodeWebSafe(mime, Utilities.Charset.UTF_8) };
  if (threadId) message.threadId = threadId;
  const d = Gmail.Users.Drafts.create({ message: message }, 'me');
  return { ok: true, draftId: d.id, threadId: d.message.threadId };
}

/** items: [{ key, email, draftId?, sinceSec }] → 每人:草稿还在吗/发出了吗/有没有新来信 */
function status_(items) {
  const out = {};
  for (const it of items) {
    const r = { draftExists: null, sent: null, inbound: null };
    if (it.draftId) {
      try { Gmail.Users.Drafts.get('me', it.draftId, { format: 'minimal' }); r.draftExists = true; } catch (err) { r.draftExists = false; }
    }
    const since = Math.max(0, Math.floor(Number(it.sinceSec) || 0));
    if (it.draftId && r.draftExists === false) {
      const s = GmailApp.search('in:sent to:' + it.email + ' after:' + since, 0, 1);
      if (s.length) r.sent = { threadId: s[0].getId(), at: s[0].getLastMessageDate().toISOString(), subject: s[0].getFirstMessageSubject() };
    }
    if (it.checkInbound) {
      // 取对方本人最新一封的时间(不能用线程最后一封,那可能是我们的回复)
      const threads = GmailApp.search('from:' + it.email + ' after:' + since, 0, 3);
      let best = null;
      threads.forEach((th) => th.getMessages().forEach((m) => {
        if (String(m.getFrom()).toLowerCase().indexOf(String(it.email).toLowerCase()) >= 0 && (!best || m.getDate() > best.at)) best = { threadId: th.getId(), at: m.getDate() };
      }));
      if (best) r.inbound = { threadId: best.threadId, at: best.at.toISOString() };
    }
    out[it.key] = r;
  }
  return { ok: true, items: out };
}
