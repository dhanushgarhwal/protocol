// lib/auth.js
//
// Single-user, shared-secret bearer auth for every browser-facing API route
// (api/notion.js, api/sync.js's manual-refresh path). This is deliberately
// not enterprise auth: one person, forever, per the project brief's
// Section 0 / Section 6 constraints. Do not add accounts, sessions, or a
// user database here.

export function requireAccessToken(req, res) {
  const expected = process.env.PROTOCOL_ACCESS_TOKEN;
  if (!expected) {
    res.status(500).json({ error: "PROTOCOL_ACCESS_TOKEN is not configured on Vercel" });
    return false;
  }
  const header = req.headers?.authorization || "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!provided || provided !== expected) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

// Best-effort, in-memory, per-warm-instance sliding-window rate limiter.
//
// This intentionally does NOT coordinate across concurrent serverless
// instances and intentionally resets on every cold start. That is an
// accepted trade-off, not an oversight: the actual threat model here is "a
// leaked URL gets casually poked at or scraped by a bot," not "a
// sophisticated distributed attacker." A real distributed rate limiter
// (e.g. a dedicated Redis instance) would be disproportionate engineering
// effort for a single-user app and is explicitly out of scope.
const hits = new Map(); // key -> array of hit timestamps (ms)
const WINDOW_MS = 60_000;
const MAX_HITS_PER_WINDOW = 60; // generous for one real user; blocks abuse, not normal use

export function rateLimit(req, res) {
  const now = Date.now();
  const key = req.headers?.authorization || "anon";
  const arr = (hits.get(key) || []).filter((t) => now - t < WINDOW_MS);
  arr.push(now);
  hits.set(key, arr);
  if (arr.length > MAX_HITS_PER_WINDOW) {
    res.status(429).json({ error: "Too many requests" });
    return false;
  }
  return true;
}
