# Protocol — secured

Added a solid minimal glass lock with a 60-second one-time code. The dashboard cannot call `/api/notion` until the code is verified, and `/api/notion` independently rejects missing/expired sessions.

Deploy `protocol-lock/` as a separate Vercel app. Set `LOCK_SESSION_SECRET` to the same random secret in both Vercel projects. Never commit the secret.
