// Vercel serverless function: GET /api/search?q=<first line of the song>
// Finds YouTube videos whose title or description contains the words of the
// song line, groups them by singer, and returns the best recording for each.
// Needs the env var YOUTUBE_API_KEY.

import { filterByCoverage, parseDuration, keepVideo, groupBySinger } from "./_lib.js";

const YT = "https://www.googleapis.com/youtube/v3";

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

export default async function handler(req, res) {
  const key = process.env.YOUTUBE_API_KEY;
  const q = String(req.query.q || "").replace(/\s+/g, " ").trim().slice(0, 120);

  if (!key) return res.status(500).json({ error: "YOUTUBE_API_KEY is not set on the server." });
  if (q.length < 3) return res.status(400).json({ error: "Type at least a few letters of the first line." });

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

    const singers = groupBySinger(result.videos, q).slice(0, 25).map((g) => ({
      name: g.name,
      via: g.via,
      videos: g.videos.map((x) => ({ id: x.id, title: x.title, channel: x.channel, views: x.views }))
    }));

    // Cache good answers at the edge for a week. Never cache an empty answer.
    res.setHeader("Cache-Control", singers.length ? "public, s-maxage=604800, stale-while-revalidate=86400" : "no-store");
    return res.status(200).json({
      query: q,
      singers,
      matched: result.required,
      words: result.total,
      relaxed: result.total > 0 && result.required < result.total
    });
  } catch (e) {
    if (e instanceof YtError) return res.status(e.status).json({ error: e.message });
    return res.status(500).json({ error: "Search failed. Try again." });
  }
}