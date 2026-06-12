import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { loadCameras } from "@/server/cameras";
import { ENV } from "@/server/env";
import { query } from "@/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const cams = loadCameras();
  const counts = await query<{ camera_id: string; n: string }>(
    `SELECT camera_id, count() AS n FROM observations GROUP BY camera_id`
  );
  const countMap = Object.fromEntries(counts.map((c) => [c.camera_id, Number(c.n)]));

  const result = cams.map((c) => {
    // latest locally captured frame for this camera (venue/mobile have no public URL)
    let latestFrame: string | null = null;
    try {
      const dir = path.join(ENV.FRAMES_DIR, c.id);
      const files = fs.readdirSync(dir).filter((f) => f.endsWith(".jpg")).sort();
      if (files.length) latestFrame = path.join("frames", c.id, files[files.length - 1]);
    } catch {
      /* no frames yet */
    }
    return { ...c, observations: countMap[c.id] ?? 0, latestFrame };
  });
  const total = Object.values(countMap).reduce((a, b) => a + b, 0);
  return NextResponse.json({ cameras: result, totalObservations: total });
}
