---
SECTION_ID: plans.brand-visual-feedback
TYPE: plan
STATUS: completed
---
# Logo and repeated visuals
- [x] Inspect styles, current markup and official brand/guide assets; no meta/rules. No applicable frontend skill found; image_edit_essentials inspected for documentary asset conversion. Reuse existing landing style, no AI-generated proof.
- [x] Replace typeset logo in header/footer with official lockup.
- [x] Keep BLOOM/UGC result posters once; use different official BLOOM structure frame in case study and editorial prompt previews in guides.
- [x] Update regression coverage, sources and cache version; verify responsive layouts, images and contact popup.
- [x] Record results. No commit/deploy requested in this task.

## Delivered and verified
- Official guides logo converted losslessly to local 384×91 WebP with alpha. Header widths: 140px at 320, 150px at 375–430, 176px at larger widths; footer 160px. No substitute lettering. Both logo assets loaded.
- Original BLOOM and UGC gallery posters appear once each. Case study uses a different authentic 1600×902 scrolling frame from the official step-2 poster, with a source caption. Guides use HTML prompt excerpts and editorial flow labels instead of duplicate photos. Sources documented in meta/resources/youtube-showcase.md. Cache version: brand-visuals-1.
- Sequential python3 -m pytest -q: 22 passed in 0.86s. Assertions cover official logo, unique posters, separate frame, prompt cards, cache version and retained contact/media behavior.
- Browser widths 320/375/390/430/768/1050/1440: no page overflow, both header links in viewport, zero guide-card/prompt overflow. No broken images at final inspection. Initial Unreal videos and iframes absent before activation.
- Inspected mobile guide screenshot .temp/images_from_tools/1006_181913721_brw_ss.png and mobile header .temp/images_from_tools/1006_181927885_brw_ss.png. Desktop 1440px QA frame shown at 50%: prompt cards .temp/images_from_tools/1006_182002366_brw_ss.png; separate case image .temp/images_from_tools/1006_182016265_brw_ss.png.
- All five contact triggers: dialog opens, PROMO and two links present, 0px opener shift, unchanged hash, exact scroll/focus restoration after close. At 320×700 the popup bounds are x=19–301, y=39.25–660.75 with no page overflow.
- Temporary QA iframe and globals removed; existing preview tab restored to landing top. No new windows. Game/Unreal/cinematic files and app.js behavior unchanged.

## Boundaries
Local implementation complete. No commit, push or deployment. Browser-width emulation is not physical-device/in-app-browser testing. No new full gameplay, video playback, messaging or redemption audit performed in this visual iteration. Final visual approval remains with the owner.

## Authorized release
- [x] Owner authorizes scoped commit/push and deployment to existing origin/main and Railway production. Developer deployment skill search returned no applicable template.
- [x] Review scoped changes and confirm regression result: scoped diff reviewed; 22 tests passed in 0.82s.
- [ ] Commit and push official logo, unique case frame, guide prompt cards and related tests/source notes.
- [ ] Confirm production deployment and verify public assets, mobile layout and contact popup.
