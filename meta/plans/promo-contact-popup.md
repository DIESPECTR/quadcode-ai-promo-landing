---
SECTION_ID: plans.promo-contact-popup
TYPE: plan
STATUS: completed
---
# Promo contact popup
- [x] Read HTML/JS/tests and project rules (none present). Developer/frontend search returned unrelated storytelling skill, no suitable frontend skill. Consulted Lumi for UI task; reuse existing charcoal/orange design and local icons.
- [x] Implement shared native dialog, compact English chooser, no CTA scroll jump, close/Escape/backdrop, scroll lock and focus restore. Preserve native disclosure without JS or dialog support.
- [x] Update tests/docs; browser QA for CTA paths, keyboard and narrow/short viewports, game/video regressions.
- [x] Record results and boundaries. No commit or deployment requested for this new iteration.

## Verification
- Final regression: `python3 -m pytest -q` returned 21 passed. README and contact regression assertions updated.
- All five CTA paths open the native modal with two official contact links. At each opener, background CTA displacement was 0px; URL hash unchanged. Close restores exact page position, opener focus and scroll unlock. Native cancel and backdrop dismissal passed synthetic event tests; clicking inside does not dismiss.
- Width/height emulation: 320×700, 375×812, 390×844, 430×932, 768×900, 1050×900, 1440×900 and 667×375. Popup bounds within viewport, no horizontal popup/page overflow, platform links at least 80px tall. Short landscape popup scrolls internally and its bottom is reachable.
- Visual screenshots inspected: mobile .temp/images_from_tools/1005_190202910_brw_ss.png; desktop .temp/images_from_tools/1005_190223481_brw_ss.png (1440×900 QA iframe displayed at 50%). Clear icons, heading, close and both platform links.
- Scripts-removed HTML in existing QA iframe: native summary opens, both links visible in original claim card, enhanced CTA and dialog hidden. This checks markup fallback rather than browser-wide scripting-disabled mode. Unsupported-dialog branch preserved but not independently emulated.
- Game smoke check: ArcRace document/canvas loaded, cinematic paused, close removed iframe and restored cover/Play focus. Muted/loop attributes retained. No new full gameplay or YouTube playback regression claimed.
- Browser console error/exception filter returned no entries. Temporary QA iframe and result globals removed; existing preview restored to page top.

## Boundaries
Local implementation complete; no commit, push or deployment. Native dialog provides keyboard focus containment; physical Tab/Shift+Tab/Escape input was not exercised with available browser tools (cancel event was simulated). No physical-device/in-app-browser, actual messaging, LinkedIn Message availability or code-redemption validation. Visual approval remains with the owner.

## Authorized popup release
- [x] Owner authorized commit and deployment to existing campaign origin/main and Railway production landing. Deployment skill search returned only unrelated storytelling, no suitable deployment template.
- [x] Reviewed scoped frontend/docs/tests diff; regression rerun: 21 passed. Unrelated plans and original media excluded.
- [ ] Commit and push six scoped files.
- [ ] Confirm Railway SUCCESS for the new commit; verify public modal, contact URLs and mobile layout.
