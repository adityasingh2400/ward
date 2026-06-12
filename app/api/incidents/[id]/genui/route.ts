import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";
import { ENV } from "@/server/env";
import { query } from "@/server/db";
import { cameraById } from "@/server/cameras";
import { promptLibrary } from "@/components/openui/promptLibrary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const anthropic = new Anthropic({ apiKey: ENV.ANTHROPIC_API_KEY });
const CACHE_DIR = path.join(process.cwd(), "logs", "genui");

/**
 * Streams OpenUI Lang for an incident: the agent literally writes the
 * interface, and the portal renders it token-by-token as it arrives.
 * Cached per incident after first generation (re-stream from disk).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const cacheFile = path.join(CACHE_DIR, `${id.replace(/[^a-zA-Z0-9_-]/g, "")}.openui`);

  if (fs.existsSync(cacheFile)) {
    return new Response(fs.readFileSync(cacheFile, "utf8"), {
      headers: { "content-type": "text/plain; charset=utf-8", "x-ward-genui": "cached" },
    });
  }

  const rows = await query<{
    id: string;
    camera_id: string;
    event_type: string;
    severity: number;
    summary: string;
    investigation: string;
    evidence_frames: string[];
    first_ts: string;
  }>(
    `SELECT id, argMax(camera_id, ts) AS camera_id, argMax(event_type, ts) AS event_type,
            argMax(severity, ts) AS severity, argMax(summary, ts) AS summary,
            argMax(investigation, ts) AS investigation, argMax(evidence_frames, ts) AS evidence_frames,
            toString(min(ts)) AS first_ts
     FROM incidents WHERE id = {id:String} GROUP BY id`,
    { id }
  );
  if (!rows.length) return new Response("not found", { status: 404 });
  const inc = rows[0];
  const cam = cameraById(inc.camera_id);

  const series = await query<{ t: string; v: number }>(
    `SELECT toString(minute) AS t, toFloat64(sum(vehicles) + sum(people)) AS v
     FROM obs_minute WHERE camera_id = {cam:String} AND minute > now() - INTERVAL 3 HOUR
     GROUP BY minute ORDER BY minute`,
    { cam: inc.camera_id }
  );

  const system = promptLibrary.prompt({
    preamble: `You are WARD's interface composer. WARD is a civic intelligence portal for city officials. For each incident you generate the exact dashboard interface that incident needs — nothing templated, nothing generic. Order components by importance for a busy official. Always start with EvidenceFrame. Include SceneTwin for physical-scene incidents. Use ONLY real data passed to you (frame paths, camera ids, series points) — never invent data.`,
    additionalRules: [
      "Severity mapping: 1-2 MONITOR, 3 NOTABLE, 4 URGENT, 5 EMERGENCY.",
      "Keep text terse and factual; officials skim.",
      "TrendChart points must come verbatim from the provided activity series (you may subsample evenly).",
    ],
  });

  const twinExists = cam && fs.existsSync(path.join(process.cwd(), "public", "twins", `${cam.id}.spz`));
  const userContent = `Incident data:
${JSON.stringify({ ...inc, camera: cam ? { id: cam.id, name: cam.name, lat: cam.lat, lng: cam.lng } : null, twin_available: !!twinExists }, null, 1)}

Real activity series (per-minute people+vehicles, last 3h): ${JSON.stringify(series)}

Generate the dashboard now.`;

  const encoder = new TextEncoder();
  let full = "";
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const s = anthropic.messages.stream({
          model: ENV.AGENT_MODEL,
          max_tokens: 8000,
          system,
          output_config: { effort: "low" },
          messages: [{ role: "user", content: userContent }],
        });
        s.on("text", (delta) => {
          full += delta;
          controller.enqueue(encoder.encode(delta));
        });
        const final = await s.finalMessage();
        if (final.stop_reason !== "refusal" && full.trim().length > 0) {
          fs.writeFileSync(cacheFile, full);
        }
        controller.close();
      } catch (e) {
        controller.enqueue(encoder.encode(`\n<!-- genui error: ${String(e).slice(0, 120)} -->`));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "text/plain; charset=utf-8", "x-ward-genui": "live" },
  });
}
