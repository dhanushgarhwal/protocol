// lib/edge-config.js
//
// Thin wrapper around Vercel Edge Config so api/notion.js, api/webhook.js,
// and api/sync.js all share one correct read/write implementation instead
// of three copy-pasted ones.
//
// Edge Config stores exactly one key here: the final, already-aggregated
// view model (aggregate()'s return value). Reads go through the low-latency
// SDK (P99 ~15ms, often <1ms); writes go through the Vercel REST API,
// because Edge Config's low-latency read path is read-only by design.
// Writes only happen on sync events (webhook fire, manual refresh, cron),
// never on a plain page load.
//
// NOTE: verify the exact current @vercel/edge-config read API and the
// Edge Config write REST endpoint shape against live Vercel documentation
// at implementation time -- platforms evolve and this file has a
// point-in-time view. Where live docs disagree with this file, live docs
// win; update this wrapper, not the callers.

import { get } from "@vercel/edge-config";

const MODEL_KEY = "protocol_model_v1";

export async function readModel() {
  try {
    return (await get(MODEL_KEY)) ?? null;
  } catch (error) {
    console.error("[protocol.edge-config] read failed:", error);
    return null; // caller falls back to the Blob-driven sync path
  }
}

export async function writeModel(model) {
  const edgeConfigId = process.env.EDGE_CONFIG_ID;
  const token = process.env.EDGE_CONFIG_WRITE_TOKEN;
  if (!edgeConfigId || !token) {
    throw new Error("EDGE_CONFIG_ID or EDGE_CONFIG_WRITE_TOKEN is not configured");
  }
  const response = await fetch(`https://api.vercel.com/v1/edge-config/${edgeConfigId}/items`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      items: [{ operation: "upsert", key: MODEL_KEY, value: model }]
    })
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Edge Config write failed: ${response.status} ${text}`);
  }
}
