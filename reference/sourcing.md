# Finding creators

The method: search for **content** (videos / hashtag posts) that the target
audience would watch, then work backwards to the people who made it. This
beats keyword search on profiles: you get creators who are actually posting
about the topic now, and their real recent numbers.

## Before you search: confirm three things with the user

1. **Product vertical**: what the product is and which creator niche it lives
   in. A brief that only gives a format ("好物分享", "day in my life") or
   reference accounts is not enough; format is not vertical. Ask.
2. **Region**: where the audience must be. TikTok search runs through a
   proxy country (`--country US` by default) which biases results but does
   not guarantee location. Bios and the review step catch the rest.
3. **Range**: follower range, minimum engagement, whether an email is required
   (pipeline.config.json → sourcing). Defaults: 1k-50k followers, ≥3%
   engagement, email required. The 3% floor comes from real review data:
   creators at 3-10% engagement passed brand review 64% of the time, under
   1% only 10%. Lower it only if the user insists.

## Picking search terms

Write terms the way the target audience describes their own day, not the way
a seller pitches to them. Searching videos and working back to authors beat a
paid creator database in our own tests, both on cost and on engagement
(database results for marketing / e-commerce niches were mostly course
sellers under 0.5% engagement).

- Search what the audience watches, not what the creator calls themselves:
  "study with me", "how I take notes", "day in my life as an SDR",
  "cold email tips".
- 3-8 terms per batch. Mix broad and specific. One wildly broad term
  (e.g. "productivity") floods the batch with big entertainment accounts.
- Instagram works by hashtag (no `#`): `--tags "studygram,notetaking"`.
- After each batch look at the 淘汰 counts: mostly "粉丝不在区间" means terms are
  too broad (big accounts) or too niche (tiny ones); mostly "没有公开邮箱" is
  normal on TikTok (often 60-80%), consider IG or `requireEmail: false`
  and find emails by hand for the best ones.

## Three channels

| Channel | Needs | Good at | Weak at |
|---|---|---|---|
| Apify keyword search | APIFY_API_KEY | real recent numbers, cheap, any niche people post videos about | many TikTok bios have no email |
| Apify find-similar | APIFY_API_KEY + 3-5 seed creators | more people like the ones that already worked | depends on seeds sharing hashtags |
| Upfluence | UPFLUENCE_USERNAME / UPFLUENCE_PASSWORD (their own account) | email and country for most profiles, YouTube too | course sellers in marketing/e-commerce niches, low engagement; TikTok profiles often lack average views (those rows get 缺播放 and need a price from the user) |

Ask which the user has; do not assume. Teams often use Upfluence for volume
and emails, and Apify to find better-engaged people in a niche.

Upfluence runs in two stages to save credits: the keyword search (≈ 2
credits per page of 50) is screened for free on bio, country, follower range
and has-email, and only the survivors (up to `--max`) get a full profile pull
(≈ 200 credits each). The plan line shows remaining credits. A 402 means
credits ran out; stop and tell the user.

```bash
node <skill_dir>/cp.js source upfluence --platform tiktok --q "study with me,notion tips" --pages 1 --max 30
```

## Two ways to search with Apify

**1. By keyword** (you know what the audience watches):
`source tiktok --q "..."` or `source instagram --tags "..."`.

**2. Find similar** (the user has creators they like, e.g. past hits or the
ones the brand approved): `source similar --platform tiktok|instagram --seeds "@a,@b,@c"`.
The engine pulls the seeds' recent posts, takes the hashtags they share
(dropping generic ones like #fyp / #viral), searches those, and keeps
people who pass the same gates. On Instagram it also adds the profile's
"related accounts" when Instagram returns them (often empty). Use 3-5 seeds
of the same kind; mixing a student and a sales coach gives muddy tags. The
output shows the tags it used; if they look off (too generic, wrong topic),
switch to keyword search with better words.

## Running

```bash
node <skill_dir>/cp.js source tiktok --q "study with me,how I take notes" --per 40 --max 60
# shows the plan and estimated cost; after the user agrees:
node <skill_dir>/cp.js source tiktok --q "study with me,how I take notes" --per 40 --max 60 --go
node <skill_dir>/cp.js source similar --platform tiktok --seeds "@seed1,@seed2,@seed3" --tags 5 --per 30 --max 60
node <skill_dir>/cp.js compute
```

- `--per`: videos per search term. `--max`: how many creator profiles to
  check (the main cost). IG: `--per` posts per hashtag, `--max` profiles.
- Cost reference: TikTok ≈ $0.003 per search result + ≈ $0.03 per profile;
  Instagram ≈ $0.002 per hashtag post + ≈ $0.003 per profile. A 3-term,
  60-profile TikTok batch is about $2.
- The key is the user's own (`APIFY_API_KEY` in their shell). Never print it,
  never write it to a file in the campaign folder.

## What the engine checks (you cannot loosen these per run)

- Follower range, not private, at least 3 recent posts
- Median engagement % over recent videos ≥ minimum
- Has a public email (bio / business email) when required
- Universal negatives in bio/name: crypto/NFT/forex, adult, giveaway/promo
  pages, "make money online"
- Sellers: course / coaching-program / agency / "DM START to join" accounts.
  Their audience is other would-be sellers, not users, and engagement is
  usually tiny. Set `sourcing.allowSellers: true` only when the campaign
  actually wants them
- Region: only when the bio clearly names one country (city, country,
  flag emoji) is it compared against excludeRegions / excludeCountries; the
  guess goes into the 地区 column. No clue = not dropped. Several countries
  ("London → NYC") = no guess.
- Posting language (TikTok only, from the platform's language tag on each
  video): dropped when `languages` is set and the creator's main language is
  not in it
- Already in the sheet (same platform + handle, or same email)

Emails: bio text and Instagram business email first; when missing, the
engine opens the creator's link-in-bio page and looks for an address there.
Many link pages load with JavaScript, so expect only a modest gain.

平均播放 is the **median** views of recent non-pinned videos, so one viral
video does not inflate the price.

## After sourcing

Show the user the new rows and let them judge fit (wrong niche, brand-unsafe
content, obvious agencies). They mark 跳过 in the Google Sheet; `pull` brings
it back. Relevance judgment is the human's; the engine only filters numbers.

## LinkedIn

LinkedIn profiles rarely list emails, so this pipeline does not source from
LinkedIn. If the user has LinkedIn targets, keep them in a separate tab with
profile links only and reach out by hand.
