/**
 * server/enrich.ts — re-run investigation + composition for an existing
 * incident (e.g. after an enrichment failure or code fix).
 *   npx tsx server/enrich.ts <incident_id>
 */
import { query, insertIncident } from "./db";
import { investigate } from "./investigate";
import { compose } from "./compose";
import { newTraceId } from "./trace";
import { cameraById } from "./cameras";

async function main() {
  const id = process.argv[2];
  if (!id) throw new Error("usage: npx tsx server/enrich.ts <incident_id>");

  const rows = await query<{
    id: string;
    camera_id: string;
    event_type: string;
    severity: number;
    summary: string;
    evidence_frames: string[];
    first_ts: string;
  }>(
    `SELECT id, argMax(camera_id, ts) AS camera_id, argMax(event_type, ts) AS event_type,
            argMax(severity, ts) AS severity, argMax(summary, ts) AS summary,
            argMax(evidence_frames, ts) AS evidence_frames, toString(min(ts)) AS first_ts
     FROM incidents WHERE id = {id:String} GROUP BY id`,
    { id }
  );
  if (!rows.length) throw new Error(`incident ${id} not found`);
  const inc = rows[0];
  const cam = cameraById(inc.camera_id);
  const traceId = newTraceId(`re-enrich-${id}`);
  console.log(`re-enriching ${id}: ${inc.event_type} @ ${inc.camera_id}`);

  const inv = await investigate(
    {
      camera_id: inc.camera_id,
      camera_name: cam?.name ?? inc.camera_id,
      ts: inc.first_ts,
      event_type: inc.event_type,
      confidence: 1,
      severity: inc.severity,
      description: inc.summary,
    },
    traceId
  );
  console.log("investigation:", inv.summary);

  const spec = await compose(
    {
      id: inc.id,
      ts: inc.first_ts,
      camera_id: inc.camera_id,
      event_type: inc.event_type,
      severity: inc.severity,
      description: inc.summary,
      frame_path: inc.evidence_frames?.[0] ?? "",
    },
    inv,
    traceId
  );
  await insertIncident({
    id: inc.id,
    ts: new Date().toISOString(),
    camera_id: inc.camera_id,
    event_type: inc.event_type,
    severity: inc.severity,
    summary: spec.headline,
    investigation: JSON.stringify(inv),
    evidence_frames: inc.evidence_frames ?? [],
    ui_spec: JSON.stringify(spec),
  });
  console.log(`ENRICHED ${id}: "${spec.headline}" (${spec.widgets.length} widgets, ${inv.queries_run} queries)`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
