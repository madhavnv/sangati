// POST /api/vote  body: { id: "<11-character YouTube video id>", v: 1 | -1 }
// 1 = "good version", -1 = "wrong song". Counts live in the Redis database.

import * as db from "./_db.js";

const PER_HOUR = 60; // votes per visitor address per hour

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  if (!db.enabled) return res.status(503).json({ error: "Voting is not set up yet." });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const id = String((body && body.id) || "");
  const v = Number(body && body.v);
  if (!/^[A-Za-z0-9_-]{11}$/.test(id) || (v !== 1 && v !== -1)) return res.status(400).json({ error: "Bad vote." });

  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  const slot = "rl:" + ip + ":" + Math.floor(Date.now() / 3600000);

  try {
    const n = await db.cmd(["INCR", slot]);
    if (n === 1) await db.cmd(["EXPIRE", slot, 7200]);
    if (n > PER_HOUR) return res.status(429).json({ error: "Too many votes. Try again later." });
    const total = await db.cmd(["HINCRBY", v === 1 ? "sg:up" : "sg:down", id, 1]);
    return res.status(200).json({ ok: true, total });
  } catch (e) {
    return res.status(500).json({ error: "Could not save the vote." });
  }
}