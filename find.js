// Vercel serverless function: GET /api/find?song=<title>&singer=<name>
// Returns up to 5 candidate videos, best first. "Best" = the singer's name appears in the
// title or channel, then highest view count. Needs the env var YOUTUBE_API_KEY.

const YT = "https://www.googleapis.com/youtube/v3";

function tokens(s) {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(function (t) { return t.length > 2; });
}

export default async function handler(req, res) {
  const key = process.env.YOUTUBE_API_KEY;
  const song = String(req.query.song || "").slice(0, 120).trim();
  const singer = String(req.query.singer || "").slice(0, 80).trim();

  if (!key) return res.status(500).json({ error: "YOUTUBE_API_KEY is not set on the server." });
  if (!song || !singer) return res.status(400).json({ error: "Send both song and singer." });

  try {
    const q = song + " " + singer;
    const searchUrl = YT + "/search?part=snippet&type=video&videoEmbeddable=true&videoCategoryId=10&maxResults=10" +
      "&q=" + encodeURIComponent(q) + "&key=" + key;
    const s = await fetch(searchUrl);
    if (!s.ok) return res.status(502).json({ error: "YouTube search failed (" + s.status + ")." });
    const sj = await s.json();
    const ids = (sj.items || []).map(function (i) { return i.id.videoId; }).filter(Boolean);
    if (!ids.length) return res.status(200).json({ items: [] });

    const vUrl = YT + "/videos?part=statistics,snippet&id=" + ids.join(",") + "&key=" + key;
    const v = await fetch(vUrl);
    if (!v.ok) return res.status(502).json({ error: "YouTube lookup failed (" + v.status + ")." });
    const vj = await v.json();

    const singerTokens = tokens(singer);
    const songTokens = tokens(song);
    const rows = (vj.items || []).map(function (i) {
      const text = (i.snippet.title + " " + i.snippet.channelTitle).toLowerCase();
      const singerHit = singerTokens.length ? singerTokens.some(function (t) { return text.indexOf(t) !== -1; }) : true;
      const songHit = songTokens.filter(function (t) { return text.indexOf(t) !== -1; }).length / (songTokens.length || 1);
      return {
        id: i.id,
        title: i.snippet.title,
        channel: i.snippet.channelTitle,
        views: Number(i.statistics && i.statistics.viewCount) || 0,
        singerHit: singerHit,
        songHit: songHit
      };
    });

    // Singer must appear and at least half the song's words must match; fall back to looser matches if none pass.
    let pool = rows.filter(function (r) { return r.singerHit && r.songHit >= 0.5; });
    if (!pool.length) pool = rows.filter(function (r) { return r.songHit >= 0.5; });
    if (!pool.length) pool = rows;
    pool.sort(function (a, b) { return b.views - a.views; });

    // Cache at the edge for a week so repeat lookups cost no YouTube quota.
    res.setHeader("Cache-Control", "public, s-maxage=604800, stale-while-revalidate=86400");
    return res.status(200).json({
      items: pool.slice(0, 5).map(function (r) { return { id: r.id, title: r.title, channel: r.channel, views: r.views }; })
    });
  } catch (e) {
    return res.status(500).json({ error: "Lookup failed. Try again." });
  }
}
