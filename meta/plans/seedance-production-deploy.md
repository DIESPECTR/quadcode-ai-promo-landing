---
SECTION_ID: plans.seedance-production-deploy
TYPE: plan
STATUS: in_progress
---
# Publish approved landing
- [x] Owner authorizes deployment; commit/push permission granted. Target origin DIESPECTR/quadcode-ai-promo-landing, main, existing Railway landing production.
- [x] Run regression suite: 21 passed.
- [x] Reviewed staged release (67 files): game build and licenses, optimized poster/video, showcase assets, frontend and tests. Source PNG/original MP4, secrets and temporary artifacts excluded. CSS/JS cache keys seedance-release-1. Git whitespace notices only in preserved upstream Babylon license.
- [ ] Commit and push release; wait for existing Railway deployment.
- [ ] Verify public landing, muted loop video, game assets, responsive layout and retired endpoints.
