import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { ENV } from "@/server/env";
import { detectFrame } from "@/server/detect";
import { insertObservation } from "@/server/db";
import { newTraceId } from "@/server/trace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "Mobile unit cam" — POST a JPEG from a phone in the field; it enters the
 * exact same detection pipeline as the fixed cameras.
 *   curl -X POST --data-binary @photo.jpg -H 'content-type: image/jpeg' \
 *        "http://<laptop-ip>:3000/api/mobile-frame?lat=37.78&lng=-122.41"
 */
export async function POST(req: NextRequest) {
  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.length < 5000) return NextResponse.json({ error: "no image" }, { status: 400 });

  const dir = path.join(ENV.FRAMES_DIR, "mobile-1");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${Date.now()}.jpg`);
  fs.writeFileSync(file, buf);

  const d = await detectFrame(file, "Mobile Unit 1 (field phone)", newTraceId("mobile-frame"));
  if (!d.frame_usable) return NextResponse.json({ ok: false, reason: "frame unusable" });

  await insertObservation({
    camera_id: "mobile-1",
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

  return NextResponse.json({ ok: true, detection: d });
}
