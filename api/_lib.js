// Helpers for /api/search. Files starting with "_" are not deployed as routes.

const NOISE = /\b(devaranama|devaranamagalu|devotional|bhakti|bhakthi|songs?|lyrics?|lyrical|video|audio|full|official|kannada|haridasa|haridasara|dasara|padagalu|padas?|hd|4k|live|concert|jukebox|meaning|translation|english|album|film|movie|vol|volume|part|episode|collection)\b/gi;
const SKIP_TITLE = /karaoke|tutorial|ringtone|#shorts|\bshorts\b|reaction|whatsapp status|status video/i;
const COMPOSER = /purandar|kanaka|vijaya\s*dasa|vyasa|jagannatha|gopala\s*dasa|vadiraja|sripada|prasanna\s*venkata|raghavendra|dasaru|dasara\b|\bdasa\b|\bdas\b/i;
const HONORIFICS = ["pandit", "pt", "dr", "smt", "shri", "sri", "vidwan", "vidushi", "kum", "kumari", "prof", "sangeetha", "kalanidhi"];

export function isKannada(s) { return /[ಀ-೿]/.test(s); }

// Loose Roman spelling: ignore long vowels, aspirates, doubled letters and v/w.
export function norm(s) {
  s = s.toLowerCase().replace(/ksh/g, "ks").replace(/x/g, "ks").replace(/w/g, "v");
  s = s.replace(/[^a-z\s]/g, " ");
  s = s.replace(/(aa|ah)/g, "a").replace(/(ee|ii|ie)/g, "i").replace(/(oo|uu)/g, "u");
  s = s.replace(/([bcdgjkpstv])h/g, "$1").replace(/h/g, "");
  s = s.replace(/(.)\1+/g, "$1");
  return s.replace(/\s+/g, " ").trim();
}

export function lev(a, b) {
  const m = a.length, n = b.length, d = [];
  for (let i = 0; i <= m; i++) d[i] = [i];
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}

// Share of the query's words that appear (loosely) in the title. 1 = all of them.
export function relevance(query, title) {
  if (isKannada(query) || isKannada(title)) return 1; // cannot compare across scripts; trust YouTube's ranking
  const q = norm(query).split(" ").filter((t) => t.length > 2);
  const t = norm(title).split(" ");
  if (!q.length) return 1;
  let hit = 0;
  for (const w of q) {
    if (t.some((u) => lev(w, u) <= (w.length >= 8 ? 2 : w.length >= 4 ? 1 : 0))) hit++;
  }
  return hit / q.length;
}

export function parseDuration(iso) {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || "");
  if (!m) return 0;
  return (Number(m[1] || 0) * 3600) + (Number(m[2] || 0) * 60) + Number(m[3] || 0);
}

function tidy(s) {
  return s.replace(NOISE, " ").replace(/[^\p{L}\p{M}\s.'’]/gu, " ").replace(/\s+/g, " ").trim();
}

function cleanChannel(c) {
  return tidy(c.replace(/\s*-\s*Topic$/i, "").replace(/\s*(VEVO|Official|Channel)$/i, ""));
}

function okName(n) {
  return n.length >= 3 && n.length <= 40 && !COMPOSER.test(n) && n.split(" ").length <= 5;
}

function compactKn(s) { return s.replace(/[\s\u200c\u200d]/g, ""); }

// True when a title segment is the song's own name rather than a singer.
function isSongSegment(query, seg) {
  if (isKannada(query)) {
    if (!isKannada(seg)) return false;
    const q = compactKn(query), g = compactKn(seg);
    return g.indexOf(q.slice(0, 5)) !== -1 || q.indexOf(g.slice(0, 5)) !== -1;
  }
  if (isKannada(seg)) return false;
  return relevance(query, seg) >= 0.5;
}

// Best guess at the singer from the video title, then the channel name.
export function extractSinger(title, channel, query) {
  query = query || "";
  const byRe = /(?:sung\s+by|rendered\s+by|vocals?\s*[:\-]|singer\s*[:\-]?|\bby\b|\bft\.?|\bfeat\.?)\s*([^|\-–—()\[\]\n,/]{3,40})/gi;
  for (const m of title.matchAll(byRe)) {
    const n = tidy(m[1]);
    if (okName(n)) return { name: n, via: "title" };
  }
  const parts = title.split(/\s+[-–—]\s+|\s*[|•·]\s*|\s*[(\[]\s*|\s*:\s+/);
  if (parts.length > 1) {
    for (let i = 0; i < parts.length; i++) {
      const raw = parts[i].replace(/[)\]]+$/, "");
      if (query && isSongSegment(query, raw)) continue;
      if (i === 0 && isKannada(raw) && !isKannada(query)) continue; // a Kannada first segment is usually the song name
      const n = tidy(raw);
      if (okName(n) && !(i === 0 && !query)) return { name: n, via: "title" };
    }
  }
  const c = cleanChannel(channel || "");
  if (c.length >= 2) return { name: c, via: "channel" };
  return { name: "Unknown singer", via: "channel" };
}

function keyTokens(name) {
  return name.toLowerCase().split(/[^\p{L}\p{M}]+/u).filter((t) => t.length > 1 && !HONORIFICS.includes(t));
}

// Group videos by singer. "Pandit Bhimsen Joshi" and "Bhimsen Joshi" end up in one group.
export function groupBySinger(videos, query) {
  const groups = [];
  for (const v of videos) {
    const { name, via } = extractSinger(v.title, v.channel, query);
    const toks = keyTokens(name);
    let g = groups.find((x) => {
      if (!toks.length || !x.toks.length) return x.name.toLowerCase() === name.toLowerCase();
      const a = new Set(x.toks), b = new Set(toks);
      const aInB = [...a].every((t) => b.has(t)), bInA = [...b].every((t) => a.has(t));
      return aInB || bInA;
    });
    if (!g) { g = { name, toks, via, videos: [] }; groups.push(g); }
    if (via === "title" && g.via === "channel") { g.name = name; g.via = "title"; }
    g.videos.push(v);
  }
  return groups.map((g) => {
    g.videos.sort((a, b) => b.views - a.views);
    return { name: g.name, via: g.via, videos: g.videos.slice(0, 4), topViews: g.videos[0].views };
  }).sort((a, b) => b.topViews - a.topViews);
}

export function keepVideo(v, query) {
  if (SKIP_TITLE.test(v.title)) return false;
  if (v.seconds && (v.seconds < 60 || v.seconds > 1500)) return false;
  return true;
}
