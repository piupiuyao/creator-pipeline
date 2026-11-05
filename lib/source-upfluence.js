/**
 * Upfluence 渠道(付费数据库,自带邮箱和国家)。用户自带账号:UPFLUENCE_USERNAME / UPFLUENCE_PASSWORD。
 *
 * 两段走,省额度:
 *   1. /matches 关键词搜(每次约 2 点)→ 只用列表里的简介/国家/粉丝先粗筛,不花详情钱
 *   2. 只对粗筛通过的前 N 个拉 /influencers/{id} 详情(每个约 200 点)→ 拿账号、互动率、播放、邮箱
 * 详情接口 402 = 额度用完,直接报错停下,不静默返回空。
 */
const IDENTITY = 'https://identity.upfluence.co';
const API = 'https://api.upfluence.co/v1';
const PLATFORM_KEY = { tiktok: 'tiktoks', instagram: 'instagrams', youtube: 'youtubes' };

export async function upfluenceToken(env = process.env) {
  const { UPFLUENCE_USERNAME: username, UPFLUENCE_PASSWORD: password } = env;
  if (!username || !password) throw new Error('没有 Upfluence 账号:先 export UPFLUENCE_USERNAME=... UPFLUENCE_PASSWORD=...');
  const res = await fetch(`${IDENTITY}/token`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ grant_type: 'password', token_lifetime: 3600, username, password, scope: 'facade_api' }),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.access_token) throw new Error(`Upfluence 登录失败(${res.status}),检查账号密码`);
  return data.access_token;
}

async function call(path, token, body) {
  const res = await fetch(`${API}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (res.status === 402) throw new Error('Upfluence 额度已用完(402),请充值或等额度重置');
  if (!res.ok) throw new Error(`Upfluence ${path} 失败: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/** 剩余额度(查不到就返回 null,不影响搜索)。 */
export async function upfluenceCredits(token) {
  try {
    const res = await fetch(`${IDENTITY}/credits`, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const d = await res.json();
    if (typeof d?.available === 'number' && typeof d?.consumed === 'number') return `${(d.available - d.consumed).toLocaleString()} 点(共 ${d.available.toLocaleString()})`;
    return d?.credits ?? d?.remaining ?? d?.balance ?? JSON.stringify(d);
  } catch { return null; }
}

/** 第 1 段:关键词搜,返回列表里的基本信息(不扣详情额度)。 */
export async function upfluenceMatches({ keywords, platform, followerMin, followerMax, pages = 1, perPage = 50 }, token, log = console.error) {
  const seen = new Map();
  for (const kw of keywords) {
    const body = {
      ordering: { value: 'relevancy', direction: 'desc' },
      criterias: [{ field: 'all', type: 'should', weight: 1.0, value: kw }],
      filters: [{ field: `${platform}.followers`, type: 'range-int', value: { from: followerMin, to: followerMax } }],
      audience_filters: [],
    };
    let got = 0;
    for (let page = 1; page <= pages; page++) {
      const d = await call(`/matches?page=${page}&per_page=${perPage}`, token, body);
      for (const inf of d.influencers ?? []) if (inf.id && !seen.has(inf.id)) { seen.set(inf.id, { ...inf, _kw: kw }); got++; }
      if ((d.matches ?? []).length < perPage) break;
    }
    log(`  Upfluence「${kw}」: ${got} 人`);
  }
  return [...seen.values()];
}

/** 第 2 段:拉详情,转成我们表里的一行。 */
export async function upfluenceDetail(basic, platform, token) {
  const d = await call(`/influencers/${basic.id}`, token);
  const acct = (d[PLATFORM_KEY[platform]] ?? [])[0];
  if (!acct) return null;
  const inf = d.influencer ?? {};
  const loc = inf.location && typeof inf.location === 'object' ? inf.location : {};
  const handle = String((platform === 'youtube' ? acct.name : acct.username || acct.name) || basic.name || '').trim().replace(/^@/, '');
  if (!handle) return null;
  const url = acct.url || acct.channel_url || (platform === 'tiktok' ? `https://www.tiktok.com/@${handle}` : platform === 'instagram' ? `https://www.instagram.com/${handle}/` : '');
  const er = typeof acct.engagement_rate === 'number' ? acct.engagement_rate * 100 : null; // Upfluence 给的是小数
  return {
    账号: '@' + handle, 姓名: inf.name || basic.name || '', 平台: platform, 主页: url,
    粉丝: acct.followers || acct.subscriber_count || '', 平均播放: acct.average_views || '',
    互动率: er == null ? '' : er.toFixed(1), 邮箱: inf.email || '',
    地区: String(inf.country || loc.country || basic.country || '').toUpperCase().slice(0, 2),
    来源: `Upfluence:${basic._kw}`, _bio: acct.description || basic.description || '', _n: 99, _link: '', _lang: basic.lang || '',
  };
}
