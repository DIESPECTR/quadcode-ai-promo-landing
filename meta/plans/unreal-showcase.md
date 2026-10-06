---
SECTION_ID: plans.unreal-showcase
TYPE: plan
STATUS: completed
---
# Unreal MCP showcase
- [x] Owner approves replacing Capybara with supplied gameplay and reordering examples. No project rules. Consulted video_edit_essentials; frontend search returned only unrelated storytelling skill. Reuse existing site styling.
- [x] Inspect source, prepare authentic poster and web video, preserve full gameplay without generated imagery.
- [x] Feature Unreal first, then BLOOM CARE, UGC ad, chess, Aethermoor. Preserve hero, promo and contacts. Lazy click-to-load native playback and direct fallback.
- [x] Update tests/source notes and verify responsive layout, playback, contact and existing media behavior.
- [x] Record completion and limitations. No commit/deploy requested.

Source: `.temp/upload/2026-10-05 13-58-08.mp4`. Owner states Unreal Engine project created entirely via Quadcode AI using MCP. Recording shows gameplay, not independent proof of the build process. Order is an editorial hypothesis, not measured conversion improvement.

## Delivered and verified
- Full 171.1-second recording was web-encoded as `static/showcase-unreal.mp4` (1600×1036 H.264/AAC, 85.9 MB, fast-start); no duration trim. Authentic frame at 00:15 is `static/showcase-unreal.webp`. No synthetic imagery.
- The results order is Unreal, BLOOM CARE, UGC ad, 3D Chess, Aethermoor. Unreal is a full-width lead card; it is still below the playable ArcRace hero and official promo.
- Native video is absent from initial markup and network until an explicit play click. It has controls, inline playback, poster, direct-file fallback, playback error copy, and pauses offscreen, when the tab is hidden, before a game launch, or when a different promo/video CTA opens.
- `python3 -m pytest -q`: 22 passed. Browser QA at 320, 375, 390, 430, 768, 1050 and 1440 CSS px: five result cards, no horizontal overflow or off-canvas cards. At 1440px the lead card is 1200px wide with a 499px player; at 390px it stacks with a 358px-wide, 231px player. Desktop and mobile screenshots inspected: `.temp/images_from_tools/1006_115516010_brw_ss.png`, `.temp/images_from_tools/1006_115534138_brw_ss.png`.
- Click-to-load check: zero Unreal MP4 requests/videos prior to activation. Activation loaded and decoded playback at 1601×1036, 171.1 seconds with native controls; seek was exercised. The video paused after scrolling it offscreen. Existing official promo/chess YouTube launchers created the correct no-cookie frames; ArcRace loaded its canvas, paused the cinematic, closed cleanly and restored Play focus. Contact modal still offered PROMO, LinkedIn and Telegram. Temporary QA iframe/globals were removed.

## Boundaries
No physical device or in-app-browser playback test. The 85.9 MB full recording can be expensive on cellular after a user explicitly presses Play. The owner statement about Quadcode AI/MCP is represented as supplied context, not independently proven by gameplay footage. No commit, push or deployment requested.
