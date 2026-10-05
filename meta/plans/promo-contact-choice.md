---
SECTION_ID: plans.promo-contact-choice
TYPE: plan
STATUS: completed
---
# Promo contact choice
- [x] Inspect current HTML/CSS/JS/tests; no project rules. Developer/frontend search returned only unrelated video storytelling skill, no applicable template. Reuse existing charcoal/orange Geist/Lexend visual reference; existing claim card inspected as style sample.
- [x] Source Bootstrap Icons v1.11.3 LinkedIn/Telegram with MIT license; no custom media generation needed.
- [x] Implement one accessible disclosure with both platform links; route promo CTAs to it. Update English instructions, FAQ and README.
- [x] Regression tests and browser checks: mobile/desktop, focus/Escape handling, disclosure, URLs, game/video preserved.
- [x] Record results. No commit/deploy in this iteration. LinkedIn page messaging availability not independently verified.

## Verification
- Final regression run: 21 tests passed after the CTA focus fix. Standard SVGs and license copied locally; URLs match owner-provided LinkedIn company page and Telegram channel.
- Three promo anchor CTAs plus the how-to link open the same native details control and focus its summary. Summary toggling and synthetic Escape handling checked; Escape restores summary focus. Native details and ordinary anchor fallback remain in HTML without JS (not separately browser-tested with scripting disabled).
- Browser-width emulation at 320/375/390/430/768/1050/1440 CSS px: no page overflow, contact links at least 76px tall. All four trigger paths passed focus/open checks after preventing default anchor navigation.
- Mobile 390px screenshot: .temp/images_from_tools/1005_183820281_brw_ss.png. Desktop 1440px screenshot: .temp/images_from_tools/1005_183920897_brw_ss.png (iframe displayed at 50%, device pixel ratio accounted for). Existing charcoal/orange card style retained, both icons load.
- Game launch loaded ArcRace document, hid cover and paused cinematic; close removed iframe, restored cover and Play focus. Video retains muted/loop attributes. No new gameplay or actual video-loop timing regression in this iteration.
- No new landing exception observed; console retains earlier host-userscript TrustedScriptURL errors and a Railway UI React error from before this task.
- Temporary QA frame/debug outline removed. Existing tab reloaded to local /#contact-options. No additional browser windows, commit, push or deployment.

## Remaining external validation
LinkedIn Message availability, real messages/replies and physical-phone/in-app-browser behavior were not tested. Company-page link is not represented as a guaranteed direct chat; copy offers Telegram if Message is unavailable. Promo terms/redemption remain outside this local frontend task.

## Authorized contact and 1,000-credit release
- [x] Owner authorized commit/deploy and confirmed promo value of 1,000 credits; benefit-led CTA applied separately from sign-up credits. Developer deployment search returned no suitable skill.
- [x] Updated regression checks: 21 tests passed in preceding run.
- [ ] Verify latest browser copy and layout.
- [ ] Review scoped staged files, commit and push main.
- [ ] Verify public Railway release and contacts.
