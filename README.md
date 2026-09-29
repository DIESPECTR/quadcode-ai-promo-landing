# Quadcode AI promo landing

English-language landing page for social traffic: official Quadcode AI videos, guides, and a link to the official Telegram channel at https://t.me/quadcodeai. Visitors open the channel and send it a **private message** about the promo; a person reviews each request. The owner confirmed 1,000 free credits on registration; these sign-up credits are separate from any promo code. The page does not issue codes, require Gmail, use a Telegram bot, or promise a code for every message. The separate promo code's value, eligibility, dates and redemption steps are not confirmed yet. The owner says channel DMs work, but cross-device QA and code redemption have not been verified.

## Local preview and tests

Use Python 3.10+. Install requirements with `python3 -m pip install -r requirements.txt`, start the app with `python3 -m uvicorn app:app --host 127.0.0.1 --port 8000`, then open `http://127.0.0.1:8000/` in your existing browser tab. Run tests with `python3 -m pytest -q`. Environment variables in `env.example` are not automatically loaded.

## Before sending promo traffic

1. The sign-up benefit is 1,000 free credits, as confirmed by the owner. Separately confirm any promo code's benefit, applicable plan, eligibility, expiration and timezone, payment requirements, support contact, and where it is redeemed. Do not present an unactivated string as a valid Quadcode AI code.
2. The owner supplied https://t.me/quadcodeai and reports having checked that channel DMs work. The public Telegram preview resolves to the Quadcode.AI channel; **a private message and channel reply from a new non-admin account across the target devices have not been independently tested**. Verify the message button and reply path in Telegram, not public post comments or a personal admin chat.
3. Define a manual workflow for eligibility, assigning only activated unique codes, repeat requests, rate/budget limits, reply times, support and an emergency stop. A Telegram account or channel subscription does not establish a unique human.
4. Test the whole path in social-app browsers, Android, iOS and desktop: landing → channel → private message → manual review → private reply → working redemption in Quadcode AI. A link click is not a code claim. Publish precise terms and redemption instructions only after verification.

## Deployment preparation

The campaign repository is https://github.com/DIESPECTR/quadcode-ai-promo-landing (private). Publish only to this campaign repository; never infer the destination from a token. Deploy as a Python ASGI app with `uvicorn app:app --host 0.0.0.0 --port "$PORT"` (set a port explicitly if the host does not provide `PORT`). Set `APP_ENV=production`, `PUBLIC_URL` to the final HTTPS origin, and a random `SESSION_SECRET` of at least 32 characters; do not put these values or a GitHub token in the repository. Use HTTPS at the edge. The landing assets live under `/static/`, so serving `static/index.html` alone from a subpath (for example, GitHub Pages) needs an asset-path change first. No production host, domain or GitHub repository has been confirmed yet.

The `.gitignore` excludes local SQLite databases, private code exports, IDE state and temporary screenshots. Before any push, check the staged file list and run the tests. Shipping code is not the same as launching the promo: the separate promo-code terms, active inventory and real redemption path are still unverified.

## Retired implementation

The previous Google OAuth, Gmail/SMTP and `/api/claim` flow remains in the repository **only for isolated regression tests**. In a normal app process `LEGACY_CLAIMS_ENABLED = False` in `app.py`: `/api/me`, `/auth/google`, `/auth/callback`, `/auth/logout` and `/api/claim` respond with HTTP 410. Do not turn it on or import codes for the channel campaign. Remove it once historical data has been handled securely. Existing secrets, CSV files and databases must not be committed.

The implementation checklist and launch blockers are in `meta/plans/landing-conversion-audit.md`.
