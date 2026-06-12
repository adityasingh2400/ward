# WARD — Build Spec (overnight build, Harness Engineering Hack)

Mission: build, run, and test WARD end to end tonight. Demo + Devpost submission 4:30pm
today; 3-min demo video + public GitHub repo required. Work autonomously milestone by
milestone. Do not stop at "code written" — every milestone must be RUN and VERIFIED
with evidence (executed commands, screenshots via browse tooling if available, logged
output to docs/evidence/). Finish state: tomorrow morning's human work is ONLY the
wire-ups listed in a generated TOMORROW.md, target under 3 hours.

## Context / what exists
- Working dir: ~/Desktop/AWS (empty except .env, .gitignore, SPEC.md). Keys in .env
  VERIFIED WORKING: ANTHROPIC_API_KEY (claude-fable-5 available), CLICKHOUSE_HOST/
  USER/PASSWORD (ClickHouse Cloud 25.12, SELECT tested). WORLDLABS_API_KEY present,
  untested. Empty slots (THESYS_API_KEY, LANGFUSE_*, FIVEONEONE_API_KEY) wire tomorrow.
- gh CLI authed as adityasingh2400. Create public repo "ward" immediately; commit per
  milestone; .env gitignored; never log secrets.
- Prior design doc: ~/.gstack/projects/aws/aditya-unknown-design-20260611-235512.md
  (architecture survives; concept evolved from PULSE to WARD per this spec).

## The product
Cities installed thousands of cameras nobody watches; policymakers govern on stale
reports. WARD: agents watch live cameras 24/7, detect visually unambiguous civic
CONDITIONS (person collapsed, pothole, illegal dumping, debris on road, blocked bike
lane/crosswalk, standing water, smoke, crowd surge — NEVER identities/faces), log every
observation to ClickHouse, and serve a portal ("Supervisor, District 6" auth stub)
where an official types a standing query in plain English ("watch for dumping and
collapses near 6th St") and gets GENERATED widget dashboards: event timeline, evidence
frames, trend charts, Leaflet+OSM map pins, and for flagship incidents an orbitable 3D
scene reconstruction with the incident annotated inside it. Pitch: "Palantir watches
people. WARD watches over the city, for the people elected to fix it."

## Architecture (follow; build clean seams for tomorrow's swaps)
- ingest/: sampler pulls JPEG frames every 10-20s from (a) public SF traffic cams —
  find genuinely working no-auth snapshot endpoints (try Caltrans CCTV D4; verify with
  curl, pick 8-12 cams, store lat/lng/heading in cameras.json), (b) macOS webcam as
  "venue cam" (imagesnap or ffmpeg avfoundation; brew install if needed), (c) POST
  /api/mobile-frame endpoint ("mobile unit cam" — phone uploads tomorrow).
- detect/: Claude vision (claude-fable-5) per frame -> strict JSON {camera_id, ts,
  event_type|null, confidence, severity, description, bbox, scene_caption}. Insert ALL
  observations including nulls (they build baselines). Conservative prompt: false
  positives kill stage credibility; prefer misses over fakes. Golden test set: ~10
  curated images (person on ground, pothole, dumping, clean street...) with expected
  outputs; run as a test and report accuracy before soak.
- db.ts seam -> ClickHouse Cloud (@clickhouse/client, async_insert): observations
  MergeTree, MV rollups per camera/event/minute, threshold triggers for Tier-1 events,
  z-score vs rolling baseline for crowd/flow. Read-only CH user for portal/agent reads.
- agents/: Watcher polls trigger queries ~5s (autonomous, no human — judging weighs
  autonomy 20%); Investigator drills in via read-only SQL tool; Composer generates the
  dashboard payload. trace.ts seam: every LLM call logged to local JSONL tonight,
  shaped like Langfuse spans so tomorrow's SDK swap is mechanical.
- Standing queries: NL -> compiler agent -> watcher spec {event_types[], cameras[],
  thresholds, window} stored in CH + active immediately. Fixed Tier-1 watchers always
  run too.
- portal/ (Next.js): hand-built shell; every widget INSIDE generated via ui.ts seam
  with provider flag: "openui-oss" tonight (open-source OpenUI/@thesysdev packages with
  Anthropic; if the OSS path fights you >45min, render Composer's structured widget-
  spec JSON with our own React widget kit tonight and note C1 wiring in TOMORROW.md —
  the seam is what matters), "c1" tomorrow when THESYS_API_KEY lands. Register custom
  <IncidentTwin> component the Composer can place in a layout.
- twin/: Spark renderer (sparkjs.dev) + three.js: loads .spz/.ply, orbit controls,
  annotation layer (marker at raycast-from-camera-viewpoint position, path polyline,
  floating evidence frame + timestamp). Build and verify tonight against a public
  sample splat. 3D is the crown not the spine — nothing else depends on it.

## World Labs (4 total generations on free plan — HARD BUDGET)
Tonight: read docs.worldlabs.ai / World API docs using WORLDLABS_API_KEY; determine if
the API can generate from an image AND return downloadable world assets (.spz/.ply or
equivalent) on this plan (web-app splat export is Standard-tier-gated). If and only if
the API path looks viable, spend EXACTLY ONE generation as the validation test — and
make it count double by using a clean frame from the best SF street cam in
cameras.json, so the test artifact IS the demo's SF twin. Wire the result into
<IncidentTwin>. Remaining budget (do not touch): venue cam twin, pothole-site twin,
1 untouchable spare — all tomorrow. If the API can't return assets, write exact
fallback steps in TOMORROW.md ($20 Standard upgrade, or Marble embed as last resort).

## TOMORROW.md must contain
Ordered <3hr wire-up checklist with exact file+line seams: Thesys C1, Langfuse SDK swap
(trace.ts), 511 key, remaining twin generations + budget, demo-day runbook (camera
checklist, rehearsal script, recording plan, Devpost submission steps).

## Rules
Real data only (live cams; physically staged events on our own cameras are fine; no
synthetic event injection). If blocked >20min on anything external, implement the
fallback, note it in TOMORROW.md, move on. Bias to shipping the spine perfectly over
gold-plating any single piece. Commit per milestone.
