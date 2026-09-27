// api/webhook.js
//
// Notion webhook receiver. This is the mechanism that turns "wait for the
// next full page load" into "server-side data is fresh within roughly a
// minute of a Notion edit, automatically, with no human action."
//
// This endpoint has its own, separate trust boundary from the rest of the
// API: it is authenticated by verifying Notion's HMAC-SHA256 request
// signature (X-Notion-Signature), NOT by PROTOCOL_ACCESS_TOKEN, because
// Notion -- not the browser -- is the caller here.
//
// One-time setup: subscribe this endpoint in the Notion integration's
// Webhooks settings to, at minimum, `page.content_updated` and
// `page.properties_updated` (the two event types that correspond to task
// edits -- status, date, category, title). Do not subscribe to every event
// type; subscribe only to what normalizePage() actually reads.
//
// Notion's subscription flow requires a handshake: the FIRST POST to a
// brand-new subscription carries a `verification_token` in the JSON body
// and NO signature (the subscription isn't active yet). This handler logs
// that token (and echoes it in the response body) so it can be pasted into
// the Notion integration UI to activate the subscription. Once activated,
// store the same value as NOTION_WEBHOOK_SECRET in Vercel's env vars --
// every subsequent real event is signed using that token as the HMAC key.
//
// After activation is confirmed, consider removing the debug-echo of the
// verification token from the response body below, since permanently
// echoing it back would itself be a minor information leak.
import crypto from "node:crypto";
import { runSync } from "../lib/notion-sync.js";

export const config = { api: { bodyParser: false } }; // need the raw body for signature verification

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function verifySignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const provided = signatureHeader.slice(7);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(provided, "hex");
  // constant-time compare
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const rawBody = await readRawBody(req);
  let payload;
  try { payload = JSON.parse(rawBody.toString("utf8")); } catch { return res.status(400).json({ error: "Invalid JSON" }); }

  // One-time handshake: no signature yet, just the verification token.
  if (payload?.verification_token && !req.headers["x-notion-signature"]) {
    console.log("[protocol.webhook] verification_token received:", payload.verification_token);
    // Paste this token into the Notion integration's Webhooks tab to activate
    // the subscription, then store it as NOTION_WEBHOOK_SECRET in Vercel.
    return res.status(200).json({ received: true });
  }

  const secret = process.env.NOTION_WEBHOOK_SECRET; // the verification_token, stored once it's issued
  const signature = req.headers["x-notion-signature"];
  if (!secret || !verifySignature(rawBody, signature, secret)) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  // Signature verified -- this really is Notion. Trigger a resync.
  // Do not block the webhook response on the full sync; Notion expects a fast ack.
  res.status(200).json({ received: true });
  try {
    await runSync({ reason: "webhook", eventType: payload?.type });
  } catch (error) {
    console.error("[protocol.webhook] sync after webhook failed:", error);
    // Do not throw here -- response is already sent. The cron fallback (api/sync.js) covers this.
  }
}
