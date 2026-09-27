import { requireAccessToken, rateLimit } from "../lib/auth.js";
import { readModel } from "../lib/edge-config.js";
import { runSync } from "../lib/notion-sync.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!requireAccessToken(req, res)) return;
  if (!rateLimit(req, res)) return;

  try {
    // Fast path: serve the pre-aggregated Edge Config model.
    const cached = await readModel();
    if (cached) {
      res.setHeader("Cache-Control", "private, no-store");
      return res.status(200).json({ model: cached });
    }
    // Cold-start recovery: synchronize Notion and repopulate Edge Config.
    const result = await runSync({ reason: "edge-cache-miss" });
    res.setHeader("Cache-Control", "private, no-store");
    return res.status(200).json({ model: result.model });
  } catch (error) {
    console.error("[protocol.notion-endpoint] failed:", error);
    const status = error?.status === 429 ? 429 : 500;
    if (status === 429) res.setHeader("Retry-After", String(error.retryAfter || 2));
    return res.status(status).json({ error: error instanceof Error ? error.message : "Unexpected server error" });
  }
}
