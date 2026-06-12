/** One-frame end-to-end spine proof: fetch -> detect -> insert -> query back. */
import fs from "node:fs";
import path from "node:path";
import { loadCameras } from "../server/cameras";
import { detectFrame } from "../server/detect";
import { insertObservation, query, roQuery } from "../server/db";
import { newTraceId } from "../server/trace";

async function main() {
  const cam = loadCameras().find((c) => c.id === "tv317i2806thstreetofframp")!;
  console.log("1) fetching frame from", cam.name);
  const res = await fetch(`${cam.img}?t=${Date.now()}`);
  const buf = Buffer.from(await res.arrayBuffer());
  console.log("   got", buf.length, "bytes");
  const dir = path.join(process.cwd(), "frames", cam.id);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `spine-${Date.now()}.jpg`);
  fs.writeFileSync(file, buf);

  console.log("2) detecting with Claude vision...");
  const t0 = Date.now();
  const d = await detectFrame(file, cam.name, newTraceId("spine-test"));
  console.log(`   ${Date.now() - t0}ms ->`, JSON.stringify(d, null, 2));

  console.log("3) inserting observation...");
  await insertObservation({
    camera_id: cam.id,
    ts: new Date().toISOString(),
    event_type: d.event_type ?? "",
    confidence: d.confidence,
    severity: d.severity,
    description: d.description,
    scene_caption: d.scene_caption,
    people_count: d.people_count,
    vehicle_count: d.vehicle_count,
    bbox: d.bbox,
    frame_path: path.relative(process.cwd(), file),
  });

  console.log("4) querying back (waiting 2s for async insert)...");
  await new Promise((r) => setTimeout(r, 2000));
  const rows = await query("SELECT camera_id, ts, event_type, scene_caption, vehicle_count FROM observations ORDER BY ts DESC LIMIT 3");
  console.table(rows);

  console.log("5) read-only user check (must fail on write, succeed on read):");
  try {
    await roQuery("SELECT count() AS n FROM observations");
    console.log("   ward_ro SELECT: OK");
  } catch (e) {
    console.log("   ward_ro SELECT FAILED:", String(e).slice(0, 150));
  }
  try {
    const { chReader } = await import("../server/db");
    await chReader().command({ query: "DROP TABLE observations" });
    console.log("   !!! ward_ro DROP SUCCEEDED — SECURITY BUG");
    process.exit(1);
  } catch {
    console.log("   ward_ro DROP blocked: OK");
  }
  console.log("SPINE: COMPLETE");
  process.exit(0);
}

main().catch((e) => {
  console.error("SPINE FAILED:", e);
  process.exit(1);
});
