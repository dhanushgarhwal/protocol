// api/sync.js
//
// Unifies two callers into one code path:
//   1. Vercel Cron, on a schedule (see vercel.json) -- a safety net in case
//      a webhook delivery is ever missed (Notion outage, transient network
//      issue, a misconfigured subscription). This is a fallback, not the
//      primary freshness mechanism -- webhooks are.
//   2. The app's manual Refresh button (browser, authenticated the normal
//      way via PROTOCOL_ACCESS_TOKEN).
//
// Disaster recovery: this is also the app's entire backup/recovery story.
// Notion remains the durable source of truth -- the Blob snapshot and Edge
// Config model are both fully rebuildable from Notion at any time. If the
// Blob snapshot ever looks corrupted or is deleted, a single authenticated
// call to `/api/sync?force=full` skips incremental sync and rebuilds
// everything from scratch via fullSync(), with no code changes required.
import { requireAccessToken, rateLimit } from "../lib/auth.js";
import { runSync } from "../lib/notion-sync.js";

const CRON_SECRET = process.env.CRON_SECRET; // Vercel Cron sends this as a bearer token; verify the exact
// current mechanism against live Vercel documentation at implementation time -- platform specifics change,
// and this endpoint must never ship without SOME verification that a caller claiming to be "the cron"
// actually is, since an unauthenticated sync-trigger endpoint would let anyone force expensive Notion API
// calls and Blob/Edge Config writes on demand.

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const isCronCall = Boolean(CRON_SECRET) && req.headers?.authorization === `Bearer ${CRON_SECRET}`;
  if (!isCronCall) {
    // Not the cron -- must be a manual refresh from the browser, so it needs the normal user auth.
    if (!requireAccessToken(req, res)) return;
    if (!rateLimit(req, res)) return;
  }

  const force = typeof req.query?.force === "string" ? req.query.force : undefined;

  try {
    const result = await runSync({ reason: isCronCall ? "cron" : "manual-refresh", force });
    return res.status(200).json({ syncedAt: result.syncedAt });
  } catch (error) {
    console.error("[protocol.sync-endpoint] failed:", error);
    const status = error?.status === 429 ? 429 : 500;
    if (status === 429) res.setHeader("Retry-After", String(error.retryAfter || 2));
    return res.status(status).json({ error: error instanceof Error ? error.message : "Unexpected server error" });
  }
}
