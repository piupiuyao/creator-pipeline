/** 全部商业参数集中在这。默认值按操作者实感标定,成交数据攒够后用 tune 重拟合。 */
export const DEFAULT_CONFIG = {
  // ── 发信人与产品(init 时问用户填;邮件里所有产品话术只来自这里) ──
  senderName: '',
  productName: '',
  productUrl: '',
  // 一句话产品介绍,接在 "We're reaching out about <产品名>, ..." 后面
  productPitch: '',
  // 合作形式,首触信和询价信里逐条列出,如 "One 30-60s TikTok video showing how you use it"
  formats: [],
  // 一句话交付物,嵌进砍价信 "For this scope, <scope>, ..."
  scope: 'one short video featuring the product',
  // 成交确认信里的内容要求清单
  briefBullets: [],
  // 付款条款原文;不填用默认 50/50
  paymentTerms: '',
  depositPct: 50,
  // 汇报发到哪个邮箱(留空 = 只存本地文件);每日任务只建草稿,不发信
  reportEmail: '',
  // 团队 Google 表(网址里 /d/ 后面那段)和本流程专用的 tab
  googleSheetId: '',
  googleSheetTab: '',
  // 表桥(sheet/bridge.gs 部署后的网址和口令):配了就能在表里直接拍板,几分钟内起草/回写
  sheetBridgeUrl: '',
  sheetBridgeToken: '',
  // 首触前要人在表里写「通过」(和平台版"批准入库"一样);false = 算完价直接起草
  requireApproval: true,
  // 盯表任务:有新回信等需要 Claude 读的事,最快多久叫一次 Claude
  claudeCooldownMinutes: 15,
  // 首触方式:offer = 首触直接报我们的价(引擎先手锚定);ask_rate = 首触只问报价单
  firstTouchMode: 'offer',

  // ── 找人闸门 ──
  sourcing: {
    followerMin: 1_000,
    followerMax: 50_000,
    // 10 月复盘:互动率 3-10% 的过审率 64%,<1% 只有 10% —— 互动率是第一道门
    minEngagementPct: 3,
    requireEmail: true,
    // true = 不过滤卖课/代运营号(有的活动就是要找这类人)
    allowSellers: false,
    // 地区:简介里能看出国家时才判。可填大区(南亚/东南亚/拉美/中东/非洲)或国家代码
    excludeRegions: [],
    excludeCountries: [],
    // 发帖语言(TikTok 有,如 ['en']);空 = 不限。西语/小语种活动填 ['es'] 等
    languages: [],
  },

  // ── 外联节奏:首触 → 3 天没回跟进 1 次 → 再 5 天没回算失联 ──
  followupAfterDays: 3,
  noResponseAfterDays: 5,
  contractFollowupAfterDays: 1,

  // ── 定价模型:公允价 = (起步价 + 每千播放单价 × 播放/1000) × 平台乘数 ──
  // 起步价 = 制作工时的钱,与观众规模无关。默认 3k播放≈$100,9k播放≈$250。
  kocBaseUsd: 25,
  kocPerKUsd: 25,
  // 平台乘数:YouTube 定制视频制作重、内容寿命长,行情高于 TT/IG 一档。
  platformMultipliers: { tiktok: 1.0, instagram: 1.0, youtube: 2.0 },
  // 第1轮开价 = 公允 × openerX。漏斗调参器(tune)按回复率/成交率建议升降。
  openerX: 0.8,
  // 照单带:要价 ≤ 公允×此数,直接按他的价成交 —— 为 $20 拉扯一轮不值
  acceptBandX: 1.15,
  // 放弃线:要价 > 公允×此数,发范围收尾信不进砍价
  kocWalkGapX: 3,
  // KOC 上限(≥此粉丝数标 KOL 手动,不出价)
  kocFollowerMax: 50_000,
  maxRounds: 2,
  minCounterUsd: 30,
  // 机器可自动写出的单笔最高报价。超过的行照算公允价,但停给人工。
  maxAutoOfferUsd: 800,
  // 买量判定
  engagementFloorPct: 0.5,
  engagementMinViews: 5_000,
};

import { readFileSync } from 'node:fs';
/** 客户配置(pipeline.config.json)压过默认值。文件不存在 = 全默认。 */
export function loadConfig(dir = process.cwd()) {
  try {
    const user = JSON.parse(readFileSync(`${dir}/pipeline.config.json`, 'utf8'));
    return { ...DEFAULT_CONFIG, ...user,
      sourcing: { ...DEFAULT_CONFIG.sourcing, ...(user.sourcing ?? {}) },
      platformMultipliers: { ...DEFAULT_CONFIG.platformMultipliers, ...(user.platformMultipliers ?? {}) } };
  } catch { return { ...DEFAULT_CONFIG }; }
}

/** 写邮件前必须有的配置。缺了宁可不出草稿,不能胡说产品。 */
export function missingVoice(cfg) {
  const miss = [];
  if (!cfg.senderName) miss.push('senderName(落款)');
  if (!cfg.productName) miss.push('productName(产品名)');
  if (!cfg.productUrl) miss.push('productUrl(产品链接)');
  if (!cfg.formats?.length && !cfg.briefBullets?.length) miss.push('formats 或 briefBullets(合作形式/内容要求)');
  return miss;
}
