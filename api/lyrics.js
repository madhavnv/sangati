// GET /api/lyrics?q=<first line of the song>
// (The file keeps its old name. It now returns the MEANING of a song in English and Kannada.
//  No lyrics are produced or shown.)
// Asks Google Gemini for a short meaning, then saves the answer in the database so each song is only
// asked once. Only runs for songs that were really searched, and stops at a daily limit.
// Needs GEMINI_API_KEY and the Redis database.
//
// The composer is shown only when the titles of the YouTube videos found for this song name the same
// composer, so a guess by the AI alone is never shown.

import * as db from "./_db.js";

export const config = { maxDuration: 60 };

const BASE = process.env.GEMINI_API_BASE || "https://generativelanguage.googleapis.com/v1beta";
const MODEL = process.env.LYRICS_MODEL || "gemini-3.5-flash-lite";
const DAILY_LIMIT = Number(process.env.LYRICS_DAILY_LIMIT) || 100;
const FALLBACKS = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.6-flash", "gemini-3.8-flash"];
const TRY_MS = Number(process.env.LYRICS_TIMEOUT_MS) || 18000; // wait this long for each model
const BUDGET_MS = 45000; // stop trying more models after this long, before the 60 second limit
const KEEP_SECONDS = 365 * 24 * 3600;
const KEY_PREFIX = "mean2:"; // new name, so older saved answers (with guessed composers) are not used

// Composers we can recognise in video titles. The first name is how it is shown.
const COMPOSERS = [
  { name: "Purandara Dasa", re: /purandar/i },
  { name: "Kanaka Dasa", re: /kanaka\s*dasa|kanakadasa|kanaka\s*dasara/i },
  { name: "Vijaya Dasa", re: /vijaya\s*dasa|vijayadasa|vijaya\s*dasara/i },
  { name: "Gopala Dasa", re: /gopala\s*dasa|gopaladasa|gopala\s*dasara/i },
  { name: "Jagannatha Dasa", re: /jagannatha\s*dasa|jagannathadasa|jagannatha\s*dasara/i },
  { name: "Mohana Dasa", re: /mohana\s*dasa|mohanadasa/i },
  { name: "Prasanna Venkata Dasa", re: /prasanna\s*venkata/i },
  { name: "Vadiraja Tirtha", re: /vadiraj/i },
  { name: "Sripadaraja", re: /sripadaraj|shripadaraj/i },
  { name: "Vyasaraja", re: /vyasaraj|vyasatirth/i },
  { name: "Helavanakatte Giriyamma", re: /giriyamma/i }
];

// Which composer, if any, the video titles agree on. `aiGuess` is only used as a second opinion.
export function pickComposer(titles, aiGuess, aiConfident) {
  const counts = COMPOSERS.map((c) => ({ name: c.name, n: titles.filter((t) => c.re.test(t)).length }))
    .filter((c) => c.n > 0)
    .sort((a, b) => b.n - a.n);
  if (!counts.length) return "";
  const best = counts[0];
  if (counts[1] && counts[1].n >= best.n) return "";          // titles disagree: say nothing
  const aiAgrees = aiConfident && typeof aiGuess === "string" &&
    COMPOSERS.some((c) => c.name === best.name && c.re.test(aiGuess));
  return best.n >= 2 || aiAgrees ? best.name : "";            // one title alone is not enough
}

const SYSTEM = "You are an expert in Haridasa sahitya and Kannada devotional songs (devaranama). " +
  "You answer with one JSON object and nothing else. Accuracy matters more than completeness: never invent. " +
  "If you are not sure which song a line belongs to, set recognised to false. " +
  "Many devaranamas are attributed to different dasas, and the composer's signature appears in the last line, " +
  "which you are not given, so give a composer only when it is a famous, undisputed attribution.";

function prompt(q, titles) {
  return "First line of a song, as a person typed or said it (spelling may be rough): " + JSON.stringify(q) + "\n" +
    (titles.length ? "Titles of YouTube videos found for it (may help you identify the song):\n- " + titles.slice(0, 8).join("\n- ") + "\n" : "") +
    "\nReturn this JSON:\n" +
    "{\n" +
    '  "recognised": true or false,\n' +
    '  "title": "the song\'s usual title in English letters",\n' +
    '  "composer": "the composer, or empty string if not certain",\n' +
    '  "composer_confidence": "high" or "low",\n' +
    '  "meaning_en": "3 to 5 plain sentences in English on what the song says and its devotional mood",\n' +
    '  "meaning_kn": "the same meaning in simple Kannada, in Kannada script, 3 to 5 sentences"\n' +
    "}";
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
  if (!db.enabled || !apiKey) return res.status(503).json({ error: "Meaning is not set up yet." });

  const q = String(req.query.q || "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (q.length < 3) return res.status(400).json({ error: "Missing song line." });
  const key = q.toLowerCase();

  try {
    const saved = await db.cmd(["GET", KEY_PREFIX + key]);
    if (saved) return res.status(200).json(JSON.parse(saved));

    // Only songs that were really searched and found. Their video titles help us find the composer.
    const searched = await db.cmd(["GET", "s:" + key]);
    if (!searched) return res.status(404).json({ error: "Search for the song first, then open the meaning." });
    let titles = [];
    try {
      const seen = new Set();
      JSON.parse(searched).singers.forEach((s) => s.videos.forEach((v) => { if (v.title && !seen.has(v.id)) { seen.add(v.id); titles.push(String(v.title).slice(0, 120)); } }));
    } catch (e) { titles = []; }

    // Daily limit on new songs
    const day = new Date().toISOString().slice(0, 10);
    const counter = "lyr:n:" + day;
    const n = await db.cmd(["INCR", counter]);
    if (n === 1) await db.cmd(["EXPIRE", counter, 172800]);
    if (n > DAILY_LIMIT) return res.status(429).json({ error: "Meanings for new songs are paused for today. Songs opened before still work. Please try again tomorrow." });

    // Try the chosen model first, then other current models.
    const models = [MODEL, ...FALLBACKS.filter((m) => m !== MODEL)];
    let j = {}, last = "";
    const started = Date.now();
    for (const m of models) {
      if (Date.now() - started > BUDGET_MS - TRY_MS) break;
      let r;
      try {
        r = await fetch(BASE + "/models/" + encodeURIComponent(m) + ":generateContent", {
          method: "POST",
          headers: { "x-goog-api-key": apiKey, "content-type": "application/json" },
          signal: AbortSignal.timeout(TRY_MS),
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: SYSTEM }] },
            contents: [{ role: "user", parts: [{ text: prompt(q, titles) }] }],
            generationConfig: { responseMimeType: "application/json", maxOutputTokens: 3000 }
          })
        });
      } catch (e) {
        console.error("Gemini " + m + " did not answer in time or could not be reached: " + (e && e.name));
        last = "(" + m + " did not answer in time)";
        continue; // try the next, faster model
      }
      j = await r.json().catch(() => ({}));
      if (r.ok) { last = ""; break; }
      const why = (j && j.error && j.error.message ? String(j.error.message) : "").replace(/\s+/g, " ").slice(0, 200);
      console.error("Gemini " + m + " failed: HTTP " + r.status + " " + why);
      if (r.status === 429) { await db.cmd(["DECR", counter]).catch(() => {}); return res.status(429).json({ error: "The free limit is used up for now. Please try again later." }); }
      last = "(" + m + ", HTTP " + r.status + (why ? ": " + why : "") + ")";
      if (r.status !== 404) break; // a bad key or a bad request will not be fixed by another model
    }
    if (last) {
      await db.cmd(["DECR", counter]).catch(() => {}); // a failed try should not use up the daily limit
      return res.status(502).json({ error: "The meaning helper is not available right now. " + last });
    }

    const o = parseJson(answerText(j));
    if (!o) { await db.cmd(["DECR", counter]).catch(() => {}); return res.status(502).json({ error: "Could not prepare the meaning. Try again later." }); }

    const out = {
      recognised: o.recognised === true,
      title: str(o.title, 120),
      composer: pickComposer(titles, str(o.composer, 80), o.composer_confidence === "high"),
      meaning: str(o.meaning_en, 900),
      meaningKn: str(o.meaning_kn, 1200),
      draft: true
    };
    if (!out.recognised) { out.meaning = ""; out.meaningKn = ""; out.composer = ""; }

    await db.cmd(["SET", KEY_PREFIX + key, JSON.stringify(out), "EX", out.recognised ? KEEP_SECONDS : 30 * 24 * 3600]);
    return res.status(200).json(out);
  } catch (e) {
    return res.status(500).json({ error: "Could not load the meaning. Try again later." });
  }
}