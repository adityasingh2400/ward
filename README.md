# WARD — the city already has eyes. We gave it a memory.

**An AI civic intelligence portal for the people elected to fix things.**
Built in one night for the Harness Engineering Hack (SF, June 12 2026).

> Palantir watches people. **WARD watches over the city** — conditions, never identities.

## The problem

Cities installed thousands of cameras nobody watches. Meanwhile the officials who decide
where money, cleanup crews, and emergency resources go are governing from weeks-old
reports and whoever shouted loudest at a town hall. A person can lie collapsed in full
view of a camera for 20 minutes. A street can drown in illegal dumping for months before
it appears in any statistic. The city has eyes; its leaders are still guessing.

## What WARD does

1. **Agents watch live cameras 24/7** — real Caltrans/SF traffic cams, a venue cam, and
   field phones, sampled continuously. Claude vision extracts civic *conditions* from
   every frame: person collapsed, pothole, illegal dumping, debris, blocked lane,
   flooding, smoke, crowd surge. Never faces, never identities.
2. **Every observation lands in ClickHouse** — millions of rows of city memory. Rollup
   materialized views build per-camera baselines; threshold + z-score triggers fire
   **autonomously** — no human in the loop from photon to incident.
3. **An investigator agent verifies before escalating** — it drills into history with a
   read-only SQL tool: has this happened here before? How unusual is this vs baseline?
4. **The interface is born, not built** — for each incident, the agent **generates the
   dashboard itself via OpenUI Lang streaming**: evidence frame, timeline, live trend
   charts (real ClickHouse data only), map pin, recommended actions — and, when spatial
   context helps, an **orbitable 3D reconstruction of the scene** (World Labs Marble →
   gaussian splat → Spark renderer) with the incident annotated in-world.
5. **Officials subscribe in plain English** — *"watch for dumping and collapses near
   6th St"* compiles instantly into a live watcher scoped to the right cameras.

## Architecture

```
 Caltrans SF cams ─┐
 venue cam (ffmpeg)├─ sampler ──► Claude vision ──► ClickHouse Cloud ◄── investigator agent
 field phone POST ─┘   (server/sampler.ts)           observations        (read-only SQL tool)
                                                     rollup MVs               │
                portal (Next.js) ◄── OpenUI Lang ◄── composer ◄── watcher ────┘
                widgets + Spark 3D twins   streaming      (autonomous, 5s poll)
```

## Sponsor tech (deep, not decorative)

- **ClickHouse Cloud** — the city's memory and the trigger engine. Every frame analysis
  (including "nothing happened" — that's what baselines are made of) is a row; per-minute
  `SummingMergeTree` rollups power baselines, trends, and sub-second drill-downs; the
  autonomous watcher IS a ClickHouse query loop; the investigator agent speaks SQL to a
  locked-down read-only user (`readonly=1` — even a prompt-injected query can't mutate).
- **OpenUI (Thesys)** — the interface layer. The agent streams OpenUI Lang and the portal
  renders it progressively with `@openuidev/react-lang` — you watch the dashboard
  assemble. Our component library registers a custom `SceneTwin` component, so the agent
  can *choose* to place a 3D scene reconstruction in a generated layout.
- **World Labs Marble** — per-camera digital twins. Each camera's scene is generated once
  (cameras don't move) via the World API and exported as `.spz`; incidents are annotated
  into the twin **live** (pulsing marker, ground ring, evidence beam) with Spark + three.js.
- **Langfuse-shaped tracing** — every LLM call is logged as a Langfuse-format generation
  span (`server/trace.ts`); the portal's audit panel makes every agent decision traceable
  back to the exact frame and reasoning. For a government tool, that's a feature.

## Quickstart

```bash
git clone https://github.com/adityasingh2400/ward && cd ward
pnpm install                      # or npm install
cp .env.example .env              # fill in ANTHROPIC_API_KEY + ClickHouse creds
npm run migrate                   # creates tables, MVs, read-only user
npm run all                       # sampler + watcher + portal (or run each separately)
open http://localhost:3000
```

Useful scripts: `npm run golden` (detection quality gate — zero-false-positive rule),
`npx tsx test/spine.ts` (one-frame e2e), `npx tsx twin/generate.ts check` (World Labs
API validation; `npx tsx twin/generate.ts <camera_id>` burns 1 of 4 free generations).

To send a field photo through the pipeline ("mobile unit cam"):

```bash
curl -X POST --data-binary @photo.jpg -H 'content-type: image/jpeg' \
  "http://<laptop-ip>:3000/api/mobile-frame"
```

## Honest engineering notes

- Detection is deliberately conservative (golden gate: **zero false positives allowed**;
  a missed minor event is acceptable, a false alarm on a city dashboard is not).
- 3D annotation is *approximate* spatial annotation — raycast from the camera viewpoint
  (which is also Marble's generation viewpoint), not survey-grade.
- All demo data is real: live public cameras, real detections, physically staged events
  on our own cameras only. No replayed or synthetic event injection.
