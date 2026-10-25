// Tiny client for an Upstash Redis database (the free one from the Vercel Marketplace).
// If the environment variables are missing, `enabled` is false and the app works exactly as before,
// just without saved searches, votes and lyrics.

const BASE = (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || "").replace(/\/$/, "");
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || "";

export const enabled = Boolean(BASE && TOKEN);

async function post(path, body) {
  const r = await fetch(BASE + path, {
    method: "POST",
    headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j) throw new Error("Database error " + r.status);
  return j;
}

// One command, e.g. cmd(["GET", "key"])
export async function cmd(args) {
  const j = await post("", args);
  if (j.error) throw new Error(j.error);
  return j.result;
}

// Several commands in one round trip. Returns the list of results.
export async function pipe(list) {
  const j = await post("/pipeline", list);
  return j.map((x) => {
    if (x.error) throw new Error(x.error);
    return x.result;
  });
}