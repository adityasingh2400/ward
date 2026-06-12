# TOMORROW.md — wire-up checklist & demo-day runbook

Target: under 3 hours of human work. Everything else is already built, tested, and
running. Read top to bottom; items are ordered by dependency and payoff.

## 0) Wake-up state check (5 min)

The overnight processes should still be running (`caffeinate` is holding the Mac awake):

```bash
curl -s localhost:3000/api/cameras | jq .totalObservations   # should be thousands
tail -5 /tmp/sampler.log                                     # frames flowing
tail -5 /tmp/watcher.log                                     # autonomous polling
```

If anything died: `npm run all` (or `npm run sampler` / `npm run watcher` / `npm run dev`
in three terminals). Re-run `caffeinate -dims &`.

**Check whether an organic incident fired overnight** — if yes, open the portal: that's
your soak-test evidence AND your first OpenUI-generated dashboard. Screenshot it into
`docs/evidence/`.

## 1) Venue-cam staged rescue test — 10 min, do this FIRST (VERIFY #3)

The webcam pipeline is verified working (capture → detect → skip dark frames). It needs
light and a subject:

1. Lights on; aim the laptop camera at some floor space.
2. Lay a hoodie/jacket person-shaped on the floor in view (at the venue: a teammate lies
   down — that's the real demo beat).
3. Within ~30s: sampler logs `venue: person_down`, watcher fires `TRIGGER`, incident +
   generated dashboard appear on the portal untouched.
4. Screenshot portal → `docs/evidence/staged-venue-incident.png`. This also exercises
   the OpenUI genui stream for real (watch the interface assemble).
5. Also verify `/twin-test` renders the sample splat in Chrome (10 sec — WebGL was
   unverifiable in the headless test browser; the code path is otherwise validated).

## 2) World Labs twins — ~40 min spread across the morning (mostly waiting)

API is VALIDATED (auth + upload + credits = 7,000 = 4 generations). Export gate
bypassed: the API returns .spz URLs directly. **Budget: 4 generations, no re-dos.**

| # | Twin | When | How |
|---|------|------|-----|
| 1 | Best SF cam (tvd01 Fremont or tv317 6th St) | ~10:00am (daylight, traffic visible) | `npx tsx twin/generate.ts tvd01i80fremont` |
| 2 | Venue cam | after your table/camera position is FINAL (~10:30) | `npx tsx twin/generate.ts venue` |
| 3 | Pothole/dumping site from the mobile-cam walk | right after the walk | `npx tsx twin/generate.ts mobile-1` |
| 4 | SPARE — do not spend | — | re-do whichever twin matters most |

Each takes ~5 min to generate; the script polls and drops the .spz into `public/twins/`
where the portal picks it up automatically. **Run #1 first and confirm end-to-end before
spending #2/#3.** If generation fails on free tier: $20 Standard upgrade (12 gens +
web export) is the sanctioned fallback; last resort is Marble web-app embed.

## 3) Mobile-cam walk (15 min, two birds)

On the walk to the venue (SoMa = target-rich), point your phone at a real pothole or
dumping pile:

```bash
# Phone on same network as laptop, or do it from the venue with a photo you took:
curl -X POST --data-binary @pothole.jpg -H 'content-type: image/jpeg' \
  "http://<laptop-ip>:3000/api/mobile-frame"
```

Real street, real defect, real detection → incident with REAL SF ground truth. Save the
frame for twin #3.

## 4) Sponsor wire-ups (seams are ready; ~45 min total)

- **Thesys C1 key** (~15 min): get key at console.thesys.dev → `.env THESYS_API_KEY`.
  The OSS OpenUI path already works with the Anthropic key, so this is optional polish:
  if you want the hosted C1 path, the seam is `ENV.UI_PROVIDER` (`server/env.ts:26`) and
  the generation call in `app/api/incidents/[id]/genui/route.ts:78` (swap
  `anthropic.messages.stream` for the C1 OpenAI-compatible endpoint). Skip if time-tight
  — judges see OpenUI Lang streaming either way, and the OSS toolkit is the prize's
  namesake.
- **Langfuse** (~15 min): cloud.langfuse.com → project → keys → `.env`. Swap shim:
  `server/trace.ts` `emit()` (line ~30) currently appends JSONL; replace body with
  `langfuse.generation({...span})` — fields are already 1:1 Langfuse-shaped. Install:
  `pnpm add langfuse`. Keep the JSONL write too (audit panel reads it).
- **511 key** (~5 min when the email lands): `.env FIVEONEONE_API_KEY`. Optional: pull
  `api.511.org/traffic/events` into the composer context (seam: `server/compose.ts`
  series query block) so dashboards can cite official incident feeds.

## 5) Demo prep (start 2:30pm, FREEZE 3:00pm)

**Demo script (3:00) — "The interface that was born, not built":**

- 0:00 Portal up. "These are live SF cameras, right now. Every frame becomes a row in
  ClickHouse — [N] observations since 10am. Nobody is watching them. WARD is."
- 0:25 Type a standing query: *"watch for dumping and anyone collapsing near 6th St"* →
  watcher appears, WATCHING. "A city official just subscribed to the physical world."
- 0:50 **Teammate collapses in view of the venue cam.** Silence. ~20 seconds later:
  TRIGGER → incident appears → **the dashboard assembles itself live via OpenUI Lang
  streaming** — evidence frame, severity, timeline, actions.
- 1:40 "It investigated before escalating" — show audit trail (every agent decision
  traced), show the investigator's SQL drill-down in the incident.
- 2:00 Open the 3D twin widget: orbit the reconstruction, incident marker pulsing where
  they fell. "Generated once per camera from a single frame — World Labs Marble —
  annotated live."
- 2:30 Show the morning's REAL incident (mobile-cam pothole, with its own twin) +
  trend charts from the day's ClickHouse history.
- 2:50 "Palantir watches people. WARD watches over the city — for the people elected
  to fix it. We didn't build these dashboards. The city's agents did."

**Logistics:** rehearse the collapse beat 3×; record 2 takes of the 3-min video by
3:30; hotspot fallback if venue WiFi flakes (everything except Caltrans pulls is
laptop-local; ClickHouse Cloud + Anthropic need internet). Lower `DEFAULT_MIN_CONF`
in `server/watcher.ts` only as config-tweak contingency (never inject data).

**Devpost (submit by 4:15, deadline 4:30):** repo is public; README is the writeup
base; video upload; team formed on Devpost; check each sponsor-prize checkbox
(ClickHouse, OpenUI/Thesys, Langfuse sub-prize, Guild "Most Innovative Use of Agents").

## 6) Known gaps / honesty list

- Twin 3D annotation is approximate (camera-axis raycast, not bbox-projected — upgrade
  in `components/IncidentTwin.tsx` markerPos if time allows).
- Flooding detection missed 1/1 golden case (conservative bias, by design) — don't
  promise flooding in the demo.
- Headless WebGL untestable → twin renderer needs the 10-sec Chrome check (item 1.5).
- `incidents` table is MergeTree with double-insert enrichment (skeleton→enriched);
  portal dedupes via argMax — fine for demo scale.
- Venue camera permission was already granted to the terminal; if you run processes
  from a NEW terminal app tomorrow, macOS may re-prompt — click Allow.

## 7) Cost/ops levers

- Per-frame vision is the spend driver: `DETECT_MODEL` env (default fable-5). If credits
  run hot during the day: `DETECT_MODEL=claude-haiku-4-5` for traffic cams is the lever
  (keep fable-5 for venue + mobile + agents).
- ClickHouse trial credits are ample for the day (~50k rows is nothing).
- World Labs: 4 generations. The budget table above is law.
