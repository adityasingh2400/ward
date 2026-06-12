/**
 * watcher.ts — the autonomous trigger loop (run: npm run watcher).
 * Polls ClickHouse every ~5s for fresh high-confidence events and statistical
 * anomalies; on trigger: investigate -> compose -> persist incident.
 * No human in the loop anywhere in this file.
 */
import { nanoid } from "nanoid";
import { query, insertIncident } from "./db";
import { investigate } from "./investigate";
import { compose } from "./compose";
import { newTraceId } from "./trace";
import { cameraById } from "./cameras";
import { WatcherSpec } from "./standing";

const POLL_MS = 5000;
const COOLDOWN_MIN = 15; // one incident per camera+type per window

// Default confidence floors per event type (standing queries can override down to 0.5).
const DEFAULT_MIN_CONF: Record<string, number> = {
  person_down: 0.7,
  pothole: 0.6,
  dumping: 0.65,
  debris: 0.65,
  blocked_lane: 0.7,
  flooding: 0.7,
  smoke_fire: 0.65,
  crowd_surge: 0.7,
  stopped_vehicle: 0.75,
};

function log(...args: unknown[]) {
  console.log(new Date().toISOString(), "[watcher]", ...args);
}

interface Candidate {
  camera_id: string;
  ts: string;
  event_type: string;
  confidence: number;
  severity: number;
  description: string;
  frame_path: string;
}

async function activeWatchers(): Promise<WatcherSpec[]> {
  const rows = await query<{ spec: string }>(`SELECT spec FROM watchers WHERE active = 1`);
  return rows
    .map((r) => {
      try {
        return JSON.parse(r.spec) as WatcherSpec;
      } catch {
        return null;
      }
    })
    .filter((s): s is WatcherSpec => !!s);
}

function confidenceFloor(c: Candidate, watchers: WatcherSpec[]): number {
  let floor = DEFAULT_MIN_CONF[c.event_type] ?? 0.7;
  for (const w of watchers) {
    const typeMatch = w.event_types.includes(c.event_type);
    const camMatch = w.camera_ids.length === 0 || w.camera_ids.includes(c.camera_id);
    if (typeMatch && camMatch) floor = Math.min(floor, Math.max(0.5, w.min_confidence));
  }
  return floor;
}

async function recentIncidentExists(camera_id: string, event_type: string): Promise<boolean> {
  const rows = await query<{ n: string }>(
    `SELECT count() AS n FROM incidents WHERE camera_id = {cam:String} AND event_type = {et:String} AND ts > now() - INTERVAL ${COOLDOWN_MIN} MINUTE`,
    { cam: camera_id, et: event_type }
  );
  return Number(rows[0]?.n ?? 0) > 0;
}

/** Statistical layer: z-score on per-minute activity vs trailing baseline. */
async function statisticalAnomalies(): Promise<Candidate[]> {
  const rows = await query<{
    camera_id: string;
    cur: number;
    mean: number;
    stddev: number;
  }>(
    `WITH cur AS (
       SELECT camera_id, toFloat64(sum(people) + sum(vehicles)) AS cur
       FROM obs_minute WHERE minute >= now() - INTERVAL 3 MINUTE GROUP BY camera_id
     ),
     base AS (
       SELECT camera_id, avg(act) AS mean, stddevPop(act) AS stddev FROM (
         SELECT camera_id, minute, toFloat64(sum(people) + sum(vehicles)) AS act
         FROM obs_minute WHERE minute BETWEEN now() - INTERVAL 90 MINUTE AND now() - INTERVAL 3 MINUTE
         GROUP BY camera_id, minute
       ) GROUP BY camera_id HAVING count() >= 20
     )
     SELECT cur.camera_id AS camera_id, cur.cur AS cur, base.mean AS mean, base.stddev AS stddev
     FROM cur INNER JOIN base ON cur.camera_id = base.camera_id
     WHERE base.stddev > 0 AND (cur.cur - base.mean) / base.stddev > 3.5 AND cur.cur > 10`
  );
  return rows.map((r) => ({
    camera_id: r.camera_id,
    ts: new Date().toISOString(),
    event_type: "crowd_surge",
    confidence: 0.75,
    severity: 3,
    description: `Activity level ${r.cur.toFixed(0)} is ${((r.cur - r.mean) / (r.stddev || 1)).toFixed(1)} standard deviations above this camera's baseline (${r.mean.toFixed(1)}).`,
    frame_path: "",
  }));
}

async function visionCandidates(): Promise<Candidate[]> {
  // NB: alias must not be named "ts" — ClickHouse resolves WHERE against the
  // SELECT alias (String) and fails with a String/DateTime supertype error.
  const rows = await query<Omit<Candidate, "ts"> & { ts_s: string }>(
    `SELECT camera_id, toString(ts) AS ts_s, event_type, confidence, severity, description, frame_path
     FROM observations
     WHERE ts > now() - INTERVAL 90 SECOND AND event_type != ''
     ORDER BY ts DESC LIMIT 50`
  );
  return rows.map(({ ts_s, ...r }) => ({ ...r, ts: ts_s }));
}

let busy = false;
async function tick() {
  if (busy) return;
  busy = true;
  try {
    const watchers = await activeWatchers();
    const candidates = [...(await visionCandidates()), ...(await statisticalAnomalies())];

    for (const c of candidates) {
      if (c.confidence < confidenceFloor(c, watchers)) continue;
      if (await recentIncidentExists(c.camera_id, c.event_type)) continue;

      const cam = cameraById(c.camera_id);
      const id = `inc-${nanoid(8)}`;
      const traceId = newTraceId(`incident-${id}`);
      log(`TRIGGER ${id}: ${c.event_type} @ ${c.camera_id} (conf ${c.confidence})`);

      // Persist a skeleton immediately so the portal shows the incident within ~1s,
      // then enrich with investigation + composed dashboard.
      await insertIncident({
        id,
        ts: new Date().toISOString(),
        camera_id: c.camera_id,
        event_type: c.event_type,
        severity: c.severity,
        summary: c.description,
        investigation: "",
        evidence_frames: c.frame_path ? [c.frame_path] : [],
        ui_spec: "",
      });

      try {
        const inv = await investigate(
          {
            camera_id: c.camera_id,
            camera_name: cam?.name ?? c.camera_id,
            ts: c.ts,
            event_type: c.event_type,
            confidence: c.confidence,
            severity: c.severity,
            description: c.description,
          },
          traceId
        );
        const spec = await compose(
          { id, ts: c.ts, camera_id: c.camera_id, event_type: c.event_type, severity: c.severity, description: c.description, frame_path: c.frame_path },
          inv,
          traceId
        );
        // ClickHouse MergeTree: insert an enriched row; portal reads argMax by ts.
        await insertIncident({
          id,
          ts: new Date().toISOString(),
          camera_id: c.camera_id,
          event_type: c.event_type,
          severity: c.severity,
          summary: spec.headline,
          investigation: JSON.stringify(inv),
          evidence_frames: c.frame_path ? [c.frame_path] : [],
          ui_spec: JSON.stringify(spec),
        });
        log(`ENRICHED ${id}: "${spec.headline}" (${spec.widgets.length} widgets, ${inv.queries_run} queries run)`);
      } catch (e) {
        log(`ENRICH FAILED ${id}:`, String(e).slice(0, 300));
      }
    }
  } catch (e) {
    log("tick error:", String(e).slice(0, 300));
  } finally {
    busy = false;
  }
}

log(`watcher starting (poll ${POLL_MS}ms, cooldown ${COOLDOWN_MIN}min) — fully autonomous`);
setInterval(tick, POLL_MS);
tick();
