// api/health.js
//
// Deliberately unauthenticated so an external free-tier uptime pinger can
// reach it without needing the access token embedded in a third-party
// service. Deliberately minimal in what it reveals: no task content, no
// counts -- just presence/absence booleans and today's date string.
import { readModel } from "../lib/edge-config.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const checks = { edgeConfig: false, notionTokenPresent: Boolean(process.env.NOTION_TOKEN) };
  try {
    const model = await readModel();
    checks.edgeConfig = Boolean(model);
    checks.lastKnownToday = model?.today || null;
  } catch (error) {
    checks.edgeConfigError = error instanceof Error ? error.message : String(error);
  }
  const healthy = checks.edgeConfig && checks.notionTokenPresent;
  return res.status(healthy ? 200 : 503).json({ healthy, checks, checkedAt: new Date().toISOString() });
}
