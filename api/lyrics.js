// GET /api/lyrics?q=<first line of the song>
// Asks Google Gemini for the composer and a short meaning of the song, then saves the answer in the
// database so each song is only asked once. Only runs for songs that were really searched
// (so strangers cannot use it for anything else), and stops at a daily limit.
// Needs GEMINI_API_KEY and the Redis database.
// Kannada lyrics are off by default, because a person should check them first.
// To turn them on, add the env var LYRICS_SHOW_TEXT=1.

import * as db from "./_db.js";

export const config = { maxDuration: 60 };

const BASE = process.env.GEMINI_API_BASE || "https://generativelanguage.googleapis.com/v1beta";
const MODEL = process.env.LYRICS_MODEL || "gemini-3.8-flash";
const DAILY_LIMIT = Number(process.env.LYRICS_DAILY_LIMIT) || 100;
const WITH_TEXT = process.env.LYRICS_SHOW_TEXT === "1";
const KEEP_SECONDS = 365 * 24 * 3600;

const SYSTEM = "You are an expert in Haridasa sahitya and Kannada devotional songs (devaranama), including the compositions of Purandara Dasa, Kanaka Dasa, Vijaya Dasa, Gopala Dasa, Jagannatha Dasa and others. " +
  "You answer with one JSON object and nothing else. Accuracy matters more than completeness: never invent words. " +
  "If you are not sure which song a line belongs to, set recognised to false." +
  (WITH_TEXT ? " If you do not know the exact words of the song, leave lyrics_kn empty." : "");

function prompt(q) {
  return "First line of a song, as a person typed or said it (spelling may be rough): " + JSON.stringify(q) + "\n\n" +
    "Return this JSON:\n" +
    "{\n" +
    '  "recognised": true or false,\n' +
    '  "title": "the song\'s usual title in English letters",\n' +
    '  "composer": "the composer, or empty string if unsure",\n' +
    '  "meaning_en": "3 to 5 plain sentences on what the song says and its devotional mood"' +
    (WITH_TEXT ? ',\n  "lyrics_kn": "the full text in Kannada script, stanzas separated by a blank line, or an empty string if you are not sure of the exact words"' : "") +
    "\n}";
}

function parseJson(text) {
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(text.slice(a, b + 1)); } catch (e) { return null; }
}

// The text of the answer, from the usual Gemini response shape.
function answerText(j) {
  const parts = j && j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts;
  if (Array.isArray(parts)) return parts.map((p) => (p && typeof p.text === "string" && !p.thought ? p.text : "")).join("");
  return "";
}

const str = (x, n) => (typeof x === "string" ? x.trim().slice(0, n) : "");

export default async function handler(req, res) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!db.enabled || !apiKey) return res.status(503).json({ error: "Lyrics are not set up yet." });

  const q = String(req.query.q || "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (q.length < 3) return res.status(400).json({ error: "Missing song line." });
  const key = q.toLowerCase();

  try {
    const saved = await db.cmd(["GET", "l:" + key]);
    if (saved) return res.status(200).json(JSON.parse(saved));

    // Only songs that were really searched and found
    const searched = await db.cmd(["EXISTS", "s:" + key]);
    if (!searched) return res.status(404).json({ error: "Search for the song first, then open the lyrics." });

    // Daily limit on new songs
    const day = new Date().toISOString().slice(0, 10);
    const counter = "lyr:n:" + day;
    const n = await db.cmd(["INCR", counter]);
    if (n === 1) await db.cmd(["EXPIRE", counter, 172800]);
    if (n > DAILY_LIMIT) return res.status(429).json({ error: "Lyrics for new songs are paused for today. Songs opened before still work. Please try again tomorrow." });

    const r = await fetch(BASE + "/models/" + encodeURIComponent(MODEL) + ":generateContent", {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: "user", parts: [{ text: prompt(q) }] }],
        generationConfig: { responseMimeType: "application/json", maxOutputTokens: 4000 }
      })
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 429) return res.status(429).json({ error: "The free lyrics limit is used up for now. Please try again later." });
    if (!r.ok) return res.status(502).json({ error: "The lyrics helper is not available right now. Try again later." });

    const o = parseJson(answerText(j));
    if (!o) return res.status(502).json({ error: "Could not prepare the lyrics. Try again later." });

    const out = {
      recognised: o.recognised === true,
      title: str(o.title, 120),
      composer: str(o.composer, 80),
      meaning: str(o.meaning_en, 900),
      lyrics: WITH_TEXT ? str(o.lyrics_kn, 4000) : "",
      draft: true
    };
    if (!out.recognised) { out.meaning = ""; out.lyrics = ""; }

    await db.cmd(["SET", "l:" + key, JSON.stringify(out), "EX", out.recognised ? KEEP_SECONDS : 30 * 24 * 3600]);
    return res.status(200).json(out);
  } catch (e) {
    return res.status(500).json({ error: "Could not load the lyrics. Try again later." });
  }
}