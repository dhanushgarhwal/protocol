# Protocol

Protocol is a minimal personal performance screen backed by Notion. It intentionally contains one responsive hero view rather than a multi-page dashboard.

## Production architecture

- Static HTML/CSS/vanilla JavaScript frontend.
- Notion remains the source of truth.
- `/api/notion` is a Vercel serverless function.
- `NOTION_TOKEN` is server-side only.
- A **private Vercel Blob** stores Protocol’s compact server-side snapshot. The browser never receives the Notion token or the raw Notion database.
- The first sync builds the snapshot; later refreshes use Notion’s `last_edited_time` filter and update only changed pages.
- Metrics and period data are aggregated on the server, so the browser receives a small view model instead of the entire database.
- Overlapping incremental syncs are deduplicated by Notion page ID.
- Notion 429 responses are surfaced with `Retry-After`; pagination requests are deliberately paced.
- The last successful snapshot can still be rendered if a later refresh fails.

This means normal Protocol usage does **not** scale Notion traffic with the total database size. A 100,000-row database does not require downloading 100,000 rows every time the dashboard opens. Only the initial snapshot build is proportional to historical data; subsequent syncs are incremental.

## Vercel setup

1. Import the project into Vercel.
2. Add `NOTION_TOKEN` as an Environment Variable.
3. Create a **private Vercel Blob store** and connect it to this project. Vercel can provide the Blob authentication to the deployed function.
4. Give the Notion integration access to the configured data source.
5. Deploy.

Vercel Private Blob is currently generally available and supports private server-side storage; Vercel documents OIDC authentication for connected projects.

## Local development

The frontend is static, but `/api/notion` needs the Vercel runtime plus Notion and Blob environment configuration. Use Vercel’s local development flow when testing the complete stack.

## Notion properties

Expected properties:

- `List the Tasks` — title or rich text
- `Date` — date
- `Status` — status/select/rich text; `Done` is completed
- `Category` — select/status/rich text

Recognized performance categories are Intelligence, Money, and Health. Casual records are excluded from performance calculations. Other categories are treated as Uncategorized during normalization.

## Data rules

- Invalid dates are excluded from performance calculations.
- Future-dated records remain visible in the year/month/week/date hierarchy; the top-level Today/Week/Month/Till date performance metrics exclude future-dated records.
- Casual records are excluded.
- Missing non-critical fields do not crash normalization.
- Zero-task periods render as `—` rather than `0%`.
- Date-only values are parsed as calendar dates to avoid timezone shifts.
- No credentials are stored in browser storage, localStorage, sessionStorage, or frontend source.

## Security

Never put `NOTION_TOKEN` in `index.html`, `styles.css`, `app.js`, localStorage, sessionStorage, or committed frontend configuration. Keep the Notion integration server-side.

## GitHub Pages

GitHub Pages can host the static files, but it cannot execute `/api/notion`. Keep the Vercel API endpoint or another secure server-side proxy if the frontend is hosted elsewhere. Never move the Notion token into client-side code.

## Design

The product is intentionally a single-screen, glass-focused hero. There is no page navigation, chart system, command palette, or scrolling dashboard.


## Vercel production setup

1. Import this project into Vercel.
2. In **Project → Settings → Environment Variables**, add `NOTION_TOKEN` for Production. Keep it server-side only.
3. In **Vercel → Storage**, create a **Blob** store and choose **Private** access, then connect it to this project. Private Blob is generally available on all Vercel plans.
4. New Blob stores use Vercel OIDC by default, so you normally do not need to manually create a long-lived `BLOB_READ_WRITE_TOKEN`. Vercel functions receive short-lived OIDC credentials automatically.
5. Redeploy the project after connecting the store.
6. Open Protocol and use **Refresh** once. The first sync creates the private snapshot; later refreshes use incremental synchronization.

If an existing Blob store still uses a static token, Vercel provides an **Upgrade to OIDC** action in the Blob store's Projects settings.

### Important

Do not put `NOTION_TOKEN` or any Blob credential in `index.html`, `app.js`, or other client-side files. The browser talks only to `/api/notion`.
