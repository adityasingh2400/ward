import { NextResponse } from "next/server";
import { query } from "@/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  // Incidents are written twice (skeleton, then enriched); take the latest row per id.
  const rows = await query(
    `SELECT id,
            argMax(camera_id, ts) AS camera_id,
            min(ts) AS first_ts,
            argMax(event_type, ts) AS event_type,
            argMax(severity, ts) AS severity,
            argMax(summary, ts) AS summary,
            argMax(investigation, ts) AS investigation,
            argMax(evidence_frames, ts) AS evidence_frames,
            argMax(ui_spec, ts) AS ui_spec
     FROM incidents
     GROUP BY id
     ORDER BY first_ts DESC
     LIMIT 30`
  );
  return NextResponse.json({ incidents: rows });
}
