# ADR-0018: Playful UI round

- Personality comes from presentation only: a mascot ("Вузлик", inline SVG, decorative, `aria-hidden`), a display font for titles and big numbers (`@fontsource-variable/unbounded`, self-hosted, has Cyrillic), a second palette (sun, pink, mint, sky) and "chunky" controls (2 px borders with a solid bottom shadow that presses in on click). Still one stylesheet, no component library.
- Rank on `/student` and the milestone badges are derived labels from nodes passed, certificates and enrollment status; nothing is stored and the learning engine is untouched. No XP, streaks or leaderboards: they would add motivation pressure that the within-subject study (D-30) cannot separate from the method.
- All motion stays behind `prefers-reduced-motion`; no copy that tests assert on changed, new copy is additive.
