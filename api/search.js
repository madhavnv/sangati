// Vercel serverless function: GET /api/search?q=<first line of the song>
// Finds YouTube videos for the song, groups them by singer, and returns the
// most-viewed recording for each singer. Needs the env var YOUTUBE_API_KEY.

import { relevance, parseDuration, keepVideo, groupBySinger } from "./_lib.js";

const YT = "https://www.googleapis.com/youtube/v3";

export default async function handler(req, res) {
  const key = process.env.YOUTUBE_API_KEY;
  const q = String(req.query.q || "").replace(/\s+/g, " ").trim().slice(0, 120);

  if (!key) return res.status(500).json({ error: "YOUTUBE_API_KEY is not set on the server." });
  if (q.length < 3) return res.status(400).json({ error: "Type at least a few letters of the first line." });

  try {
    const term = /devaranama|ದೇವರನಾಮ/i.test(q) ? q : q + " devaranama";
    const sUrl = YT + "/search?part=snippet&type=video&videoEmbeddable=true&maxResults=50&q=" +
      encodeURIComponent(term) + "&key=" + key;
    const s = await fetch(sUrl);
    const sj = await s.json();
    if (!s.ok) {
      const reason = sj && sj.error && sj.error.errors && sj.error.errors[0] && sj.error.errors[0].reason;
      if (reason === "quotaExceeded" || reason === "dailyLimitExceeded") {
        return res.status(429).json({ error: "Today's YouTube search limit is used up. It resets at midnight Pacific time. Songs searched before still open." });
      }
      const why = sj && sj.error && sj.error.message ? " " + String(sj.error.message).replace(/<[^>]*>/g, "").slice(0, 220) : "";
      return res.status(502).json({ error: "YouTube search failed (" + s.status + (reason ? ", " + reason : "") + ")." + why });
    }
    const ids = (sj.items || []).map((i) => i.id && i.id.videoId).filter(Boolean);
    if (!ids.length) return res.status(200).json({ query: q, singers: [] });

    const vUrl = YT + "/videos?part=statistics,snippet,contentDetails&id=" + ids.join(",") + "&key=" + key;
    const v = await fetch(vUrl);
    const vj = await v.json();
    if (!v.ok) {
      const why2 = vj && vj.error && vj.error.message ? " " + String(vj.error.message).replace(/<[^>]*>/g, "").slice(0, 220) : "";
      return res.status(502).json({ error: "YouTube lookup failed (" + v.status + ")." + why2 });
    }

    let videos = (vj.items || []).map((i) => ({
      id: i.id,
      title: i.snippet.title,
      channel: i.snippet.channelTitle,
      views: Number(i.statistics && i.statistics.viewCount) || 0,
      seconds: parseDuration(i.contentDetails && i.contentDetails.duration)
    })).filter((x) => keepVideo(x, q));

    // Keep videos whose title matches the song. If that leaves too few, keep them all.
    const matched = videos.filter((x) => relevance(q, x.title) >= 0.5);
    if (matched.length >= 3) videos = matched;

    const singers = groupBySinger(videos, q).slice(0, 25).map((g) => ({
      name: g.name,
      via: g.via,
      videos: g.videos.map((x) => ({ id: x.id, title: x.title, channel: x.channel, views: x.views }))
    }));

    // Cache at the edge for a week so repeat searches cost no YouTube quota.
    res.setHeader("Cache-Control", "public, s-maxage=604800, stale-while-revalidate=86400");
    return res.status(200).json({ query: q, singers });
  } catch (e) {
    return res.status(500).json({ error: "Search failed. Try again." });
  }
}