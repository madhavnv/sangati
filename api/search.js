// Vercel serverless function: GET /api/search?q=<first line of the song>
// Finds YouTube videos whose title or description contains the words of the
// song line, groups them by singer, and returns the best recording for each.
// Needs the env var YOUTUBE_API_KEY. If a Redis database is connected (see _db.js),
// results are saved so the same song never costs YouTube quota twice, and user votes
// are applied to the order of recordings.

import { filterByCoverage, parseDuration, keepVideo, groupBySinger } from "./_lib.js";
import * as db from "./_db.js";

const YT = process.env.YT_API_BASE || "https://www.googleapis.com/youtube/v3";
const SAVE_SECONDS = 30 * 24 * 3600;
const HIDE_AT = -3; // a recording with this many more "wrong song" than "good version" votes is hidden

class YtError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function yt(path) {
  const r = await fetch(YT + path);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = j && j.error;
    const reason = e && e.errors && e.errors[0] && e.errors[0].reason;
    if (reason === "quotaExceeded" || reason === "dailyLimitExceeded") {
      throw new YtError(429, "Today's YouTube search limit is used up. It resets at midnight Pacific time. Songs searched before still open.");
    }
    const why = e && e.message ? " " + String(e.message).replace(/<[^>]*>/g, "").slice(0, 220) : "";
    throw new YtError(502, "YouTube request failed (" + r.status + (reason ? ", " + reason : "") + ")." + why);
  }
  return j;
}

async function searchPage(term, key, pageToken) {
  const sj = await yt("/search?part=snippet&type=video&videoEmbeddable=true&maxResults=50&q=" +
    encodeURIComponent(term) + (pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : "") + "&key=" + key);
  const ids = (sj.items || []).map((i) => i.id && i.id.videoId).filter(Boolean);
  if (!ids.length) return { videos: [], next: null };
  const vj = await yt("/videos?part=statistics,snippet,contentDetails&id=" + ids.join(",") + "&key=" + key);
  const videos = (vj.items || []).map((i) => ({
    id: i.id,
    title: i.snippet.title,
    channel: i.snippet.channelTitle,
    description: String(i.snippet.description || "").slice(0, 300),
    views: Number(i.statistics && i.statistics.viewCount) || 0,
    seconds: parseDuration(i.contentDetails && i.contentDetails.duration)
  }));
  return { videos, next: sj.nextPageToken || null };
}

function unique(videos) {
  const seen = new Set();
  return videos.filter((v) => (seen.has(v.id) ? false : (seen.add(v.id), true)));
}

// Put each singer's best-voted recording first, hide recordings people marked as the wrong song.
function applyVotes(singers, up, down) {
  const out = [];
  for (const s of singers) {
    const vids = s.videos
      .map((v) => ({ ...v, up: up[v.id] || 0, down: down[v.id] || 0 }))
      .filter((v) => v.up - v.down > HIDE_AT);
    if (!vids.length) continue;
    vids.sort((a, b) => (b.up - b.down) - (a.up - a.down)); // stable: ties keep the original order
    out.push({ ...s, videos: vids });
  }
  return out;
}

export default async function handler(req, res) {
  const key = process.env.YOUTUBE_API_KEY;
  const q = String(req.query.q || "").replace(/\s+/g, " ").trim().slice(0, 120);

  if (q.length < 3) return res.status(400).json({ error: "Type at least a few letters of the first line." });

  const saveKey = "s:" + q.toLowerCase();
  let singers = null;
  let info = null;

  // 1. Saved result from an earlier search of the same line
  if (db.enabled) {
    try {
      const raw = await db.cmd(["GET", saveKey]);
      if (raw) { const o = JSON.parse(raw); singers = o.singers; info = o; }
    } catch (e) { /* the database is optional; fall through to YouTube */ }
  }

  // 2. Otherwise ask YouTube
  if (!singers) {
    if (!key) return res.status(500).json({ error: "YOUTUBE_API_KEY is not set on the server." });
    try {
      const term = /devaranama|ದೇವರನಾಮ/i.test(q) ? q : q + " devaranama";

      const p1 = await searchPage(term, key);
      let all = p1.videos;
      let result = filterByCoverage(all.filter((v) => keepVideo(v, q)), q);

      // YouTube ranks loosely, so the first 50 may hold few true matches. Look at the next 50 before giving up.
      if (result.videos.length < 5 && p1.next) {
        const p2 = await searchPage(term, key, p1.next);
        all = unique(all.concat(p2.videos));
        result = filterByCoverage(all.filter((v) => keepVideo(v, q)), q);
      }

      singers = groupBySinger(result.videos, q).slice(0, 25).map((g) => ({
        name: g.name,
        via: g.via,
        videos: g.videos.map((x) => ({ id: x.id, title: x.title, channel: x.channel, views: x.views }))
      }));
      info = { matched: result.required, words: result.total, relaxed: result.total > 0 && result.required < result.total };

      if (db.enabled && singers.length) {
        try { await db.cmd(["SET", saveKey, JSON.stringify({ singers, ...info }), "EX", SAVE_SECONDS]); } catch (e) { /* ignore */ }
      }
    } catch (e) {
      if (e instanceof YtError) return res.status(e.status).json({ error: e.message });
      return res.status(500).json({ error: "Search failed. Try again." });
    }
  }

  // 3. Apply votes (never lets a database problem break the search)
  if (db.enabled && singers.length) {
    try {
      const ids = [...new Set(singers.flatMap((s) => s.videos.map((v) => v.id)))];
      const [ups, downs] = await db.pipe([["HMGET", "sg:up", ...ids], ["HMGET", "sg:down", ...ids]]);
      const up = {}, down = {};
      ids.forEach((id, i) => { up[id] = Number(ups && ups[i]) || 0; down[id] = Number(downs && downs[i]) || 0; });
      singers = applyVotes(singers, up, down);
    } catch (e) { /* ignore */ }
  }

  // Votes change, so with a database the edge copy is short. Without one, keep the old week-long copy.
  const fresh = db.enabled ? "public, s-maxage=60, stale-while-revalidate=300" : "public, s-maxage=604800, stale-while-revalidate=86400";
  res.setHeader("Cache-Control", singers.length ? fresh : "no-store");
  return res.status(200).json({
    query: q,
    singers,
    matched: info.matched,
    words: info.words,
    relaxed: info.relaxed,
    votes: db.enabled,
    lyrics: db.enabled && Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY)
  });
}