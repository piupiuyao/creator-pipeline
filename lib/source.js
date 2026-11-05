/**
 * 找人:用 Apify 在 TikTok 搜视频 / 在 Instagram 搜话题 → 反找作者 → 拉作者近期作品算播放和互动 → 过闸 → 入表。
 * 用户自带 APIFY_API_KEY。闸门(粉丝区间/互动率/有邮箱/负面词/去重)在这里写死,agent 不能放水。
 *
 * 费用参考(2026 实测):TikTok 搜索约 $0.003/条视频;作者主页每人约 $0.03(10 条作品);IG 话题+主页每人约 $0.003。
 */
const API = 'https://api.apify.com/v2';
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+\w/;
// 通用负面:加密币/网赚/成人/抽奖号/机构代运营 —— 这些号回信率和品牌安全都差
const NEGATIVE = /crypto|bitcoin|\bnft\b|forex|web3|onlyfans|18\+|nsfw|giveaway page|\bdm (me )?for promo|promo page|shoutout|make money online|passive income|刷粉|涨粉|网赚/i;
// 卖水的:卖课/代运营/招学员的号互动低、受众是同行不是用户(10 月复盘:营销/电商类大多是这种)
const SELLER = /\b(agency|my course|free course|masterclass|mentorship|coaching program|1:1 coaching|join my (program|community)|dm (me )?["']?\w+["']? to (join|start|apply)|apply (now|below)|book a call|students? enrolled|clients? served|we help (brands|businesses)|grow your (page|account))\b|代运营|招学员|带学员/i;

// 地区线索:只看简介里的国家/城市/国旗(平台不给国家字段)。宁缺勿错:没线索 = 不判。
const COUNTRY_HINTS = [
  ['US', /\b(usa|u\.s\.a?\.?|united states|new york|nyc|los angeles|san francisco|seattle|austin|chicago|miami|texas|california|florida|boston|atlanta)\b|🇺🇸/i],
  ['CA', /\b(canada|toronto|vancouver|montreal|calgary)\b|🇨🇦/i],
  ['GB', /\b(uk|united kingdom|england|scotland|wales|london|manchester)\b|🇬🇧/i],
  ['AU', /\b(australia|sydney|melbourne|brisbane|perth)\b|🇦🇺/i],
  ['NZ', /\b(new zealand|auckland|wellington)\b|🇳🇿/i],
  ['IE', /\b(ireland|dublin)\b|🇮🇪/i],
  ['IN', /\b(india|mumbai|delhi|bengaluru|bangalore|hyderabad|chennai|kolkata)\b|🇮🇳/i],
  ['PK', /\b(pakistan|karachi|lahore|islamabad)\b|🇵🇰/i],
  ['BD', /\b(bangladesh|dhaka)\b|🇧🇩/i],
  ['PH', /\b(philippines|manila|cebu)\b|🇵🇭/i],
  ['ID', /\b(indonesia|jakarta|bali)\b|🇮🇩/i],
  ['MY', /\b(malaysia|kuala lumpur)\b|🇲🇾/i],
  ['NG', /\b(nigeria|lagos|abuja)\b|🇳🇬/i],
  ['BR', /\b(brasil|brazil|são paulo|sao paulo|rio de janeiro)\b|🇧🇷/i],
  ['MX', /\b(méxico|mexico|cdmx)\b|🇲🇽/i],
  ['AE', /\b(dubai|abu dhabi|uae)\b|🇦🇪/i],
];
export const REGION_GROUPS = {
  南亚: ['IN', 'PK', 'BD', 'LK', 'NP'], 东南亚: ['PH', 'ID', 'MY', 'TH', 'VN', 'SG'],
  拉美: ['BR', 'MX', 'AR', 'CO', 'CL', 'PE'], 中东: ['AE', 'SA', 'EG', 'QA', 'TR'], 非洲: ['NG', 'ZA', 'KE', 'GH'],
};
export function countryHint(text) {
  const hits = COUNTRY_HINTS.filter(([, re]) => re.test(text || '')).map(([c]) => c);
  return hits.length === 1 ? hits[0] : ''; // 多个国家(比如 "UK → NYC")不判
}

/** 简介链接页(linktree 等)里常有商务邮箱。只在没邮箱时抓,8 秒超时,失败就算了。 */
async function emailFromLink(url) {
  if (!/^https?:\/\//.test(url || '')) return '';
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
    const res = await fetch(url, { signal: ctl.signal, redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0' } });
    clearTimeout(t);
    const html = (await res.text()).slice(0, 500_000);
    const found = [...html.matchAll(/(?:mailto:)?([\w.+-]+@[\w-]+\.[a-z]{2,}(?:\.[a-z]{2,})?)/gi)].map((m) => m[1].toLowerCase())
      .filter((e) => !/(example|sentry|wixpress|linktr\.ee|beacons\.ai|domain|email\.com|\.png|\.jpg)/.test(e));
    return found[0] ?? '';
  } catch { return ''; }
}
export async function enrichEmails(candidates, log = console.error) {
  const todo = candidates.filter((c) => !c.邮箱 && c._link);
  for (let i = 0; i < todo.length; i += 8) {
    await Promise.all(todo.slice(i, i + 8).map(async (c) => { const e = await emailFromLink(c._link); if (e) { c.邮箱 = e; c._emailFrom = 'link'; } }));
  }
  const got = todo.filter((c) => c._emailFrom === 'link').length;
  if (todo.length) log(`  简介链接补邮箱: ${got}/${todo.length}`);
  return candidates;
}

const majority = (xs) => { const c = {}; for (const x of xs) if (x && x !== 'un') c[x] = (c[x] ?? 0) + 1; const top = Object.entries(c).sort((a, b) => b[1] - a[1])[0]; return top && top[1] >= 2 ? top[0] : ''; };
const median = (xs) => { const a = xs.filter((x) => Number.isFinite(x)).sort((p, q) => p - q); if (!a.length) return null; const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };

export async function apifyRun(actor, input, token, { log = console.error } = {}) {
  if (!token) throw new Error('没有 APIFY_API_KEY:先 export APIFY_API_KEY=你的key');
  const start = await fetch(`${API}/acts/${actor}/runs?token=${token}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
  });
  if (!start.ok) throw new Error(`Apify 启动失败 ${actor}: ${start.status} ${await start.text()}`);
  let run = (await start.json()).data;
  while (['READY', 'RUNNING'].includes(run.status)) {
    await new Promise((r) => setTimeout(r, 10_000));
    run = (await (await fetch(`${API}/actor-runs/${run.id}?token=${token}`)).json()).data;
  }
  if (run.status !== 'SUCCEEDED') throw new Error(`Apify ${actor} 结束状态 ${run.status}`);
  const items = await (await fetch(`${API}/datasets/${run.defaultDatasetId}/items?clean=true&token=${token}`)).json();
  log(`  ${actor}: ${items.length} 条, 花费约 $${(run.usageTotalUsd ?? 0).toFixed(2)}`);
  return { items, usd: run.usageTotalUsd ?? 0 };
}

/** TikTok:关键词搜视频 → 作者 → 作者主页近 10 条作品。 */
export async function sourceTikTok({ queries, perQuery = 40, maxProfiles = 60, country = 'US' }, cfg, token, log) {
  const g = cfg.sourcing; let usd = 0;
  const s = await apifyRun('clockworks~tiktok-scraper', {
    searchQueries: queries, resultsPerPage: perQuery, searchSection: '/video', proxyCountryCode: country,
    shouldDownloadVideos: false, shouldDownloadCovers: false, shouldDownloadSubtitles: false,
  }, token, { log }); usd += s.usd;
  const authors = new Map();
  for (const v of s.items) {
    const a = v.authorMeta; if (!a?.name) continue;
    if (a.fans < g.followerMin || a.fans > g.followerMax || a.privateAccount) continue;
    if (!authors.has(a.name)) authors.set(a.name, { meta: a, query: v.searchQuery || v.input || queries.join('/') });
  }
  const names = [...authors.keys()].slice(0, maxProfiles);
  if (!names.length) return { candidates: [], usd };
  const p = await apifyRun('clockworks~tiktok-scraper', {
    profiles: names, resultsPerPage: 10, profileScrapeSections: ['videos'], proxyCountryCode: country,
    shouldDownloadVideos: false, shouldDownloadCovers: false, shouldDownloadSubtitles: false,
  }, token, { log }); usd += p.usd;
  const vids = new Map();
  for (const v of p.items) { const n = v.authorMeta?.name; if (!n || v.isPinned) continue; (vids.get(n) ?? vids.set(n, []).get(n)).push(v); }
  const candidates = names.map((n) => {
    const a = (vids.get(n)?.[0]?.authorMeta) ?? authors.get(n).meta, vs = vids.get(n) ?? [];
    const views = median(vs.map((v) => v.playCount));
    const er = median(vs.filter((v) => v.playCount > 0).map((v) => ((v.diggCount + v.commentCount + v.shareCount) / v.playCount) * 100));
    const bio = a.signature ?? '';
    return {
      账号: '@' + n, 姓名: a.nickName ?? '', 平台: 'tiktok', 主页: `https://www.tiktok.com/@${n}`,
      粉丝: a.fans, 平均播放: views == null ? '' : Math.round(views), 互动率: er == null ? '' : er.toFixed(1),
      邮箱: (bio.match(EMAIL) ?? [''])[0], 地区: countryHint(bio), 来源: `TikTok搜索:${authors.get(n).query}`,
      _bio: bio, _n: vs.length, _link: a.bioLink || '', _lang: majority(vs.map((v) => v.textLanguage)),
    };
  });
  return { candidates, usd };
}

/** Instagram:话题 → 发帖人 → 主页(含最近 12 条)。 */
export async function sourceInstagram({ hashtags, perTag = 100, maxProfiles = 80, extraUsernames = [] }, cfg, token, log) {
  let usd = 0;
  const s = await apifyRun('apify~instagram-hashtag-scraper', { hashtags, resultsLimit: perTag }, token, { log }); usd += s.usd;
  const owners = new Map(extraUsernames.map((u) => [u, '相关账号'])); // 相关账号排前面,最像
  for (const it of s.items) if (it.ownerUsername && !owners.has(it.ownerUsername)) owners.set(it.ownerUsername, (it.hashtags?.[0]) ?? '');
  const names = [...owners.keys()].slice(0, maxProfiles);
  const profiles = [];
  for (let i = 0; i < names.length; i += 40) {
    const p = await apifyRun('apify~instagram-profile-scraper', { usernames: names.slice(i, i + 40) }, token, { log });
    usd += p.usd; profiles.push(...p.items);
  }
  const candidates = profiles.filter((p) => p.username && !p.private).map((p) => {
    const posts = p.latestPosts ?? [];
    const vids = posts.filter((x) => Number(x.videoViewCount) > 0);
    const views = median(vids.map((x) => Number(x.videoViewCount)));
    const er = vids.length
      ? median(vids.map((x) => ((Number(x.likesCount) + Number(x.commentsCount)) / Number(x.videoViewCount)) * 100))
      : median(posts.map((x) => ((Number(x.likesCount) + Number(x.commentsCount)) / (p.followersCount || 1)) * 100));
    const bio = p.biography ?? '';
    return {
      账号: '@' + p.username, 姓名: p.fullName ?? '', 平台: 'instagram', 主页: `https://www.instagram.com/${p.username}`,
      粉丝: p.followersCount ?? '', 平均播放: views == null ? '' : Math.round(views), 互动率: er == null ? '' : er.toFixed(1),
      邮箱: p.businessEmail || p.publicEmail || (bio.match(EMAIL) ?? [''])[0], 地区: countryHint(bio), 来源: `IG话题:#${owners.get(p.username) ?? ''}`,
      _bio: bio, _n: posts.length, _link: p.externalUrl || '', _lang: '',
    };
  });
  return { candidates, usd };
}

/** 单人的简介/地区判断,闸门和 Upfluence 粗筛共用。返回淘汰原因或 null。 */
export function profileRejectReason({ bio = '', name = '', country = '', lang = '' }, cfg) {
  const g = cfg.sourcing, text = `${bio} ${name}`;
  if (NEGATIVE.test(text)) return '负面词(币/网赚/成人/推广号)';
  if (!g.allowSellers && SELLER.test(text)) return '卖课/代运营/招学员';
  const banned = new Set([...(g.excludeCountries ?? []), ...(g.excludeRegions ?? []).flatMap((r) => REGION_GROUPS[r] ?? [])]);
  if (country && banned.has(country)) return '地区不在范围';
  if (g.languages?.length && lang && !g.languages.includes(lang)) return '发帖语言不对';
  return null;
}

/** 闸门。返回 { kept, dropped: {原因: 人数} }。 */
export function gate(candidates, existingRows, cfg) {
  const g = cfg.sourcing, dropped = {}, kept = [];
  const seen = new Set(existingRows.flatMap((r) => [`${(r['平台'] || '').toLowerCase()}:${(r['账号'] || '').replace(/^@/, '').toLowerCase()}`, (r['邮箱'] || '').toLowerCase()]).filter((k) => k && !k.endsWith(':')));
  const drop = (why) => { dropped[why] = (dropped[why] ?? 0) + 1; };
  for (const c of candidates) {
    const key = `${c.平台}:${c.账号.replace(/^@/, '').toLowerCase()}`;
    if (seen.has(key) || (c.邮箱 && seen.has(c.邮箱.toLowerCase()))) { drop('表里已有'); continue; }
    const f = Number(c.粉丝);
    if (String(c.粉丝).trim() !== '' && !(f >= g.followerMin && f <= g.followerMax)) { drop('粉丝不在区间'); continue; }
    const why = profileRejectReason({ bio: c._bio, name: c.姓名, country: c.地区, lang: c._lang }, cfg);
    if (why) { drop(why); continue; }
    if (c._n < 3) { drop('近期作品太少'); continue; }
    if (c.互动率 !== '' && Number(c.互动率) < g.minEngagementPct) { drop(`互动率<${g.minEngagementPct}%`); continue; }
    if (g.requireEmail && !c.邮箱) { drop('没有公开邮箱'); continue; }
    seen.add(key); if (c.邮箱) seen.add(c.邮箱.toLowerCase());
    const { _bio, _n, _link, _lang, _emailFrom, ...row } = c; kept.push(row);
  }
  return { kept, dropped };
}

// 找相似:给几个种子账号 → 拉他们近期作品 → 取他们共同常用的话题标签 → 用这些标签去搜 → 反找作者 → 同样过闸,按"和种子标签重合度"排序。
// (平台没有现成的"相似账号"接口能稳定拿到:IG 的 relatedProfiles 实测多为空,有就顺带用上。)
const GENERIC_TAGS = new Set(['fyp', 'foryou', 'foryoupage', 'viral', 'trending', 'explore', 'explorepage', 'reels', 'reel',
  'instagood', 'tiktok', 'tiktokviral', 'fypシ', 'xyzbca', 'capcut', 'love', 'instagram', 'like', 'follow', 'trend', 'viralvideo']);

export function topTags(postsBySeed, n) {
  const seedCount = new Map(), total = new Map();
  for (const posts of postsBySeed) {
    const mine = new Set();
    for (const p of posts) for (const t of p) { const k = t.toLowerCase().replace(/^#/, ''); if (k && !GENERIC_TAGS.has(k)) { mine.add(k); total.set(k, (total.get(k) ?? 0) + 1); } }
    for (const k of mine) seedCount.set(k, (seedCount.get(k) ?? 0) + 1);
  }
  // 先看几个种子共用,再看总次数
  return [...total.keys()].sort((a, b) => (seedCount.get(b) - seedCount.get(a)) || (total.get(b) - total.get(a))).slice(0, n);
}

export async function sourceSimilar({ platform, seeds, tags = 5, per = 30, maxProfiles = 60, country = 'US' }, cfg, token, log = console.error) {
  const names = seeds.map((s) => s.replace(/^@/, '').trim()).filter(Boolean);
  let usd = 0, related = [], postsBySeed = [], sizes = [];
  if (platform === 'tiktok') {
    const p = await apifyRun('clockworks~tiktok-scraper', { profiles: names, resultsPerPage: 15, profileScrapeSections: ['videos'], proxyCountryCode: country,
      shouldDownloadVideos: false, shouldDownloadCovers: false, shouldDownloadSubtitles: false }, token, { log }); usd += p.usd;
    const by = new Map();
    for (const v of p.items) { const n = v.authorMeta?.name; if (!n) continue; (by.get(n) ?? by.set(n, []).get(n)).push((v.hashtags ?? []).map((h) => h.name ?? h)); sizes.push(v.authorMeta.fans); }
    postsBySeed = [...by.values()];
  } else if (platform === 'instagram') {
    const p = await apifyRun('apify~instagram-profile-scraper', { usernames: names }, token, { log }); usd += p.usd;
    for (const prof of p.items) {
      postsBySeed.push((prof.latestPosts ?? []).map((x) => x.hashtags ?? (String(x.caption ?? '').match(/#[\p{L}\p{N}_]+/gu) ?? [])));
      sizes.push(prof.followersCount);
      related.push(...(prof.relatedProfiles ?? []).map((r) => r.username).filter(Boolean));
    }
  } else throw new Error('similar 只支持 tiktok / instagram');
  const tagList = topTags(postsBySeed, tags);
  if (!tagList.length) throw new Error('种子账号近期作品里没有可用的话题标签,换几个种子或改用关键词搜');
  log(`  种子共用标签: ${tagList.map((t) => '#' + t).join(' ')}${related.length ? `;IG 相关账号 ${related.length} 个` : ''}`);
  const res = platform === 'tiktok'
    ? await sourceTikTok({ queries: tagList, perQuery: per, maxProfiles, country }, cfg, token, log)
    : await sourceInstagram({ hashtags: tagList, perTag: per, maxProfiles, extraUsernames: related }, cfg, token, log);
  const seedSet = new Set(names.map((n) => n.toLowerCase()));
  const candidates = res.candidates.filter((c) => !seedSet.has(c.账号.slice(1).toLowerCase()))
    .map((c) => ({ ...c, 来源: `相似:${names.slice(0, 3).map((n) => '@' + n).join(' ')}` }));
  const s = sizes.filter((x) => x > 0).sort((a, b) => a - b);
  return { candidates, usd: usd + res.usd, tags: tagList, seedFollowers: s.length ? [s[0], s.at(-1)] : null };
}
