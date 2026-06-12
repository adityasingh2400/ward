# WARD — overnight build verification report

Build night: June 12, 2026, ~00:30–02:00 PDT. All evidence in this directory.

## VERIFY conditions scorecard

| # | Condition | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Golden detection gate, zero false positives | ✅ PASS 9/10, 0 FP, all critical positives (person_down 0.95, pothole 0.95, dumping 0.90) | `golden-results.json`; flooding miss = conservative-by-design |
| 2 | Soak: cams→detect→CH→autonomous trigger→dashboard, 10+ min | 🟡 PARTIAL — pipeline soaking cleanly (50+ obs, 10 cams, watcher polling 5s, zero errors after fix); full-loop trigger awaits a real event (organic overnight or staged at venue — monitor armed) | `portal-overview-night1.png`, sampler/watcher logs |
| 3 | Staged venue-cam test fires incident dashboard | ⏳ BLOCKED-PHYSICAL — venue cam pipeline verified (capture✓, permission✓, dark-frame skip✓); needs light + person-shaped subject. TOMORROW.md item 1 (10 min) | `venue` capture test |
| 4 | Plain-English standing query activates | ✅ PASS — "watch for dumping and anyone collapsed near 6th St" → compiled spec, 3 correct SoMa cams, live in portal | screenshot, watcher row in CH |
| 5 | Twin viewer orbits splat with annotation | 🟡 PARTIAL — viewer+annotation code complete; WL API VALIDATED (auth+upload+credits=7000); sample splat staged; WebGL unrenderable in headless test browser (SwiftShader) → 10-sec Chrome check + daylight generation tomorrow | `twin-renderer-sample.png` (error-state degradation), `twin/generate.ts check` output |
| 6 | Fresh-clone quickstart works | ✅ PASS — clone→install→migrate→spine e2e from /tmp/ward-fresh | this report |
| 7 | Public repo, no secrets | ✅ PASS — github.com/adityasingh2400/ward; .env gitignored from commit zero | git history |
| 8 | TOMORROW.md complete | ✅ PASS — wire-ups + twin budget + demo runbook + honesty list | TOMORROW.md |

Bonus (not in VERIFY): **OpenUI generation contract proven offline** — genui dry-run:
model emits valid OpenUI Lang against our library (0 parse errors, 0 unresolved refs),
composes emergency dashboards with correct priority ordering. First live render will
not be the first render.

## Key engineering decisions logged

- Forced tool_choice unsupported on claude-fable-5 → structured outputs
  (`output_config.format`) everywhere; refusal stop_reason handled in every agent.
- ClickHouse alias shadowing (`toString(ts) AS ts` breaks WHERE) → aliases renamed.
- OpenUI requires zod/v4 import; children via `z.array(Child.ref)` + `useRenderNode()`.
- World Labs free tier: web export gated, but **API returns .spz URLs directly** —
  validated without spending; all 4 generations preserved for daylight frames.
- Caltrans placeholder frames are ~13.1KB → size-gate + SHA-dedupe before any API spend.
