/** 调团队表里的 Apps Script 桥(sheet/bridge.gs)。没配置桥 = 返回 null,调用方走旧的手动同步。 */
export function bridgeFrom(cfg) {
  if (!cfg.sheetBridgeUrl || !cfg.sheetBridgeToken || !cfg.googleSheetTab) return null;
  const call = async (action, payload = {}) => {
    const res = await fetch(cfg.sheetBridgeUrl, {
      method: 'POST', redirect: 'follow', headers: { 'content-type': 'text/plain' }, // text/plain 免预检,Apps Script 照样收
      body: JSON.stringify({ token: cfg.sheetBridgeToken, action, tab: cfg.googleSheetTab, ...payload }),
    });
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { throw new Error(`表桥返回的不是 JSON(${res.status}):多半是部署权限不对,见 reference/sheet-bridge.md。开头: ${text.slice(0, 120)}`); }
    if (!data.ok) throw new Error(`表桥 ${action} 失败: ${data.error}`);
    return data;
  };
  return {
    read: () => call('read'),
    write: (header, rows, clear) => call('write', { header, rows, clear }),
    draft: (mail) => call('draft', mail),
    status: (items) => call('status', { items }),
  };
}
