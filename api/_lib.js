// Helpers for /api/search. Files starting with "_" are not deployed as routes.

const NOISE = /\b(devaranama|devaranamagalu|devotional|bhakti|bhakthi|songs?|lyrics?|lyrical|video|audio|full|official|kannada|haridasa|haridasara|dasara|padagalu|padas?|hd|4k|live|concert|jukebox|meaning|translation|english|album|film|movie|vol|volume|part|episode|collection)\b/gi;
const SKIP_TITLE = /karaoke|tutorial|ringtone|#shorts|\bshorts\b|reaction|whatsapp status|status video/i;
const COMPOSER = /purandar|kanaka|vijaya\s*dasa|vyasa|jagannatha|gopala\s*dasa|vadiraja|sripada|prasanna\s*venkata|raghavendra|dasaru|dasara\b|\bdasa\b|\bdas\b/i;
const HONORIFICS = ["pandit", "pt", "dr", "smt", "shri", "sri", "vidwan", "vidushi", "kum", "kumari", "prof", "sangeetha", "kalanidhi"];

export function isKannada(s) { return /[\u0c80-\u0cff]/.test(s); }

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
    if (!isKannada(seg)) return relevance(translit(query), seg) >= 0.5; // Roman title, Kannada query
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
    g.videos.sort((a, b) => (b.cov || 0) - (a.cov || 0) || b.views - a.views);
    return { name: g.name, via: g.via, videos: g.videos.slice(0, 4), topViews: g.videos[0].views, topCov: g.videos[0].cov || 0 };
  }).sort((a, b) => b.topCov - a.topCov || b.topViews - a.topViews);
}

export function keepVideo(v, query) {
  if (SKIP_TITLE.test(v.title)) return false;
  if (v.seconds && (v.seconds < 60 || v.seconds > 1500)) return false;
  return true;
}

// ---- Kannada script to loose Roman spelling (same table the page uses) ----
const CONS = { "ಕ": "k", "ಖ": "kh", "ಗ": "g", "ಘ": "gh", "ಙ": "ng", "ಚ": "ch", "ಛ": "chh", "ಜ": "j", "ಝ": "jh", "ಞ": "nj", "ಟ": "t", "ಠ": "th", "ಡ": "d", "ಢ": "dh", "ಣ": "n", "ತ": "t", "ಥ": "th", "ದ": "d", "ಧ": "dh", "ನ": "n", "ಪ": "p", "ಫ": "ph", "ಬ": "b", "ಭ": "bh", "ಮ": "m", "ಯ": "y", "ರ": "r", "ಱ": "r", "ಲ": "l", "ಳ": "l", "ವ": "v", "ಶ": "sh", "ಷ": "sh", "ಸ": "s", "ಹ": "h" };
const VOW = { "ಅ": "a", "ಆ": "a", "ಇ": "i", "ಈ": "i", "ಉ": "u", "ಊ": "u", "ಋ": "ri", "ಎ": "e", "ಏ": "e", "ಐ": "ai", "ಒ": "o", "ಓ": "o", "ಔ": "au" };
const SIGN = { "ಾ": "a", "ಿ": "i", "ೀ": "i", "ು": "u", "ೂ": "u", "ೃ": "ri", "ೆ": "e", "ೇ": "e", "ೈ": "ai", "ೊ": "o", "ೋ": "o", "ೌ": "au" };

export function translit(s) {
  let out = "", i = 0;
  s = s.replace(/[\u200c\u200d]/g, "");
  while (i < s.length) {
    const ch = s.charAt(i), nx = s.charAt(i + 1);
    if (CONS[ch] !== undefined) {
      out += CONS[ch];
      if (nx === "್") { i += 2; continue; }
      if (SIGN[nx] !== undefined) { out += SIGN[nx]; i += 2; continue; }
      out += "a"; i++; continue;
    }
    if (VOW[ch] !== undefined) { out += VOW[ch]; i++; continue; }
    if (ch === "ಂ") { out += "m"; i++; continue; }
    if (ch === "ಃ") { out += "h"; i++; continue; }
    out += ch; i++;
  }
  return out.replace(/\s+/g, " ").trim();
}

function romanForm(s) { return isKannada(s) ? translit(s) : s; }

// The words of the query that a video must contain.
export function queryTokens(query) {
  return norm(romanForm(query).replace(NOISE, " ")).split(" ").filter((t) => t.length > 1);
}

// How many of the query words appear (loosely spelled) in the text.
export function coverage(tokens, text) {
  const words = norm(romanForm(text)).split(" ");
  const joined = words.join("");
  let hit = 0;
  for (const w of tokens) {
    const tol = w.length >= 8 ? 2 : w.length >= 4 ? 1 : 0;
    const found = words.some((u) => u === w || (tol > 0 && Math.abs(u.length - w.length) <= tol && lev(w, u) <= tol)) ||
      (w.length >= 5 && joined.indexOf(w) !== -1);
    if (found) hit++;
  }
  return hit;
}

// Keep only videos that contain all the words. If that leaves fewer than 3, allow one
// or two missing words (a speech-recognition slip), but never fewer than 2 words matching.
export function filterByCoverage(videos, query) {
  const tokens = queryTokens(query);
  const n = tokens.length;
  if (!n) return { videos, required: 0, total: 0 };
  const scored = videos.map((v) => ({ ...v, cov: coverage(tokens, v.title + " " + (v.description || "")) }));
  const floor = n >= 2 ? 2 : 1;
  const tiers = [];
  for (let t = n; t >= Math.max(floor, n - 2); t--) tiers.push(t);
  for (let i = 0; i < tiers.length; i++) {
    const res = scored.filter((v) => v.cov >= tiers[i]);
    if (res.length >= 3 || i === tiers.length - 1) return { videos: res, required: tiers[i], total: n };
  }
  return { videos: [], required: n, total: n };
}