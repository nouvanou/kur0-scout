// Public, no-auth source layer.
//
// Design rule: every source here is reachable without an API key, an account,
// or a signature. If a claim in a brief cannot be traced back to one of these
// public sources (or to an on-chain read), the agent does not make the claim.
//
// All fetches run in parallel and fail soft: one dead source never blocks the
// others, and the failure is reported in the scan result instead of hidden.

const UA = { "User-Agent": "kur0-scout/1.0 (+research agent; read-only)" };

async function fetchText(url, ms = 8000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { headers: UA, signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally {
    clearTimeout(t);
  }
}

const stripTags = (s) =>
  s.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
   .replace(/&gt;/g, ">").replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"')
   .replace(/\s+/g, " ").trim();

// --- airdrops.io: article cards -------------------------------------------
function parseAirdropsIo(html) {
  const out = [];
  for (const block of html.split("<article").slice(1)) {
    const href = block.match(/<a[^>]+href="(https:\/\/airdrops\.io\/[^"]+)"/)?.[1];
    const title = block.match(/<h[23][^>]*>(?:<a[^>]*>)?([^<]{4,120})/)?.[1];
    const published = block.match(/data-published="([^"]+)"/)?.[1] ?? null;
    if (href && title) out.push({ title: stripTags(title), url: href, source: "airdrops.io", publishedAt: published });
  }
  return out;
}

// --- RSS (crypto news + Medium tag feed) ------------------------------------
function parseRss(xml, source) {
  const out = [];
  for (const item of xml.split("<item>").slice(1)) {
    const rawTitle = item.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/)?.[1];
    const rawLink = item.match(/<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/)?.[1];
    const date = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] ?? null;
    if (rawTitle && rawLink) out.push({ title: stripTags(rawTitle), url: stripTags(rawLink), source, publishedAt: date });
  }
  return out;
}

// --- Telegram public channel previews (t.me/s/<channel>) --------------------
function parseTelegram(html, channel) {
  const out = [];
  for (const block of html.split("tgme_widget_message_wrap").slice(1)) {
    const text = block.match(/tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/)?.[1];
    const link = block.match(/href="(https:\/\/t\.me\/[^"]+)"/)?.[1];
    const time = block.match(/<time[^>]+datetime="([^"]+)"/)?.[1] ?? null;
    if (text) out.push({ title: stripTags(text).slice(0, 160), url: link ?? `https://t.me/${channel}`, source: `telegram:${channel}`, publishedAt: time });
  }
  return out;
}

// --- Reddit via the Arctic Shift public archive API --------------------------
async function fetchReddit(sub) {
  const url = `https://arctic-shift.photon-reddit.com/api/posts/search?subreddit=${sub}&sort=desc&limit=25`;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(url, { headers: UA, signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    return (j.data ?? []).map((p) => ({
      title: p.title ?? "",
      url: `https://www.reddit.com${p.permalink ?? ""}`,
      source: `reddit:r/${sub}`,
      publishedAt: p.created_utc ? new Date(p.created_utc * 1000).toISOString() : null,
    }));
  } finally {
    clearTimeout(t);
  }
}

export const SOURCES = [
  { id: "airdrops-io", run: async () => parseAirdropsIo(await fetchText("https://airdrops.io/")) },
  { id: "news:cointelegraph", run: async () => parseRss(await fetchText("https://cointelegraph.com/rss"), "cointelegraph") },
  { id: "news:cryptoslate", run: async () => parseRss(await fetchText("https://cryptoslate.com/feed/"), "cryptoslate") },
  { id: "medium:airdrop", run: async () => parseRss(await fetchText("https://medium.com/feed/tag/airdrop"), "medium") },
  { id: "telegram:AirdropJacks", run: async () => parseTelegram(await fetchText("https://t.me/s/AirdropJacks"), "AirdropJacks") },
  { id: "reddit:airdrops", run: () => fetchReddit("airdrops") },
  { id: "reddit:CryptoAirdrops", run: () => fetchReddit("CryptoAirdrops") },
];

// Headline signals that mark an item as an *opportunity lead* worth a brief
// (as opposed to general news). Deliberately conservative: better to surface
// a lead as "unverified" than to miss an early one.
const SIGNAL = /\b(airdrop|free mint|mint is live|mint now open|testnet|points program|claim (is )?(live|open)|whitelist|allowlist|mainnet launch|token generation|tge|quest|snapshot)\b/i;

export async function scanSources() {
  const started = new Date().toISOString();
  const results = await Promise.allSettled(SOURCES.map((s) => s.run()));
  const items = [];
  const sourceStatus = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      sourceStatus.push({ source: SOURCES[i].id, ok: true, items: r.value.length });
      items.push(...r.value);
    } else {
      sourceStatus.push({ source: SOURCES[i].id, ok: false, error: String(r.reason?.message ?? r.reason) });
    }
  });
  // Dedupe by URL, newest first where a date exists.
  const seen = new Set();
  const unique = items.filter((it) => it.url && !seen.has(it.url) && seen.add(it.url));
  return {
    scannedAt: started,
    sourceStatus,
    totalItems: unique.length,
    leads: unique.filter((it) => SIGNAL.test(it.title)),
    items: unique,
  };
}
