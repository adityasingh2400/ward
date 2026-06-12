/**
 * sampler.ts — the ingest loop (run: npm run sampler).
 * Pulls frames from traffic cams (HTTP) + venue cam (ffmpeg/avfoundation),
 * skips placeholders & duplicate frames, runs detection, inserts EVERY
 * observation (including event_type='') into ClickHouse for baselines.
 */
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { loadCameras, Camera } from "./cameras";
import { detectFrame } from "./detect";
import { insertObservation, query } from "./db";
import { newTraceId } from "./trace";
import { ENV } from "./env";

const execFileP = promisify(execFile);
const lastHash = new Map<string, string>();
let venueFailures = 0;

function log(...args: unknown[]) {
  console.log(new Date().toISOString(), ...args);
}

async function activeWatchHints(): Promise<string[]> {
  try {
    const rows = await query<{ spec: string }>(`SELECT spec FROM watchers WHERE active = 1`);
    return rows
      .map((r) => {
        try {
          const s = JSON.parse(r.spec);
          return s.hint as string;
        } catch {
          return "";
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function fetchTrafficFrame(cam: Camera): Promise<string | null> {
  const res = await fetch(`${cam.img}?t=${Date.now()}`, { signal: AbortSignal.timeout(12000) });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 15000) return null; // "Temporarily Unavailable" placeholder is ~13.1KB
  const hash = crypto.createHash("sha1").update(buf).digest("hex");
  if (lastHash.get(cam.id) === hash) return null; // unchanged frame, skip API spend
  lastHash.set(cam.id, hash);
  const dir = path.join(ENV.FRAMES_DIR, cam.id);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${Date.now()}.jpg`);
  fs.writeFileSync(file, buf);
  return file;
}

async function captureVenueFrame(cam: Camera): Promise<string | null> {
  if (ENV.VENUE_CAM !== "on" || venueFailures >= 3) return null;
  const dir = path.join(ENV.FRAMES_DIR, cam.id);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${Date.now()}.jpg`);
  try {
    // Default macOS camera = avfoundation video device 0. First run triggers the
    // OS camera-permission prompt for the terminal app — click Allow once.
    await execFileP(
      "ffmpeg",
      ["-hide_banner", "-loglevel", "error", "-f", "avfoundation", "-framerate", "30", "-i", "0:none", "-frames:v", "1", "-y", file],
      { timeout: 15000 }
    );
    if (!fs.existsSync(file) || fs.statSync(file).size < 5000) throw new Error("empty capture");
    venueFailures = 0;
    // Cheap darkness gate: a black 1552x1552 webcam JPEG compresses to ~19KB.
    // Don't spend a vision call on an unlit room.
    if (fs.statSync(file).size < 26000) {
      fs.unlinkSync(file);
      return null;
    }
    return file;
  } catch (e) {
    venueFailures++;
    log(`venue cam capture failed (${venueFailures}/3)`, String(e).slice(0, 120));
    if (venueFailures === 3) log("venue cam DISABLED for this run — grant camera permission and restart (see TOMORROW.md)");
    return null;
  }
}

async function processCamera(cam: Camera, hints: string[]) {
  try {
    const file = cam.kind === "venue" ? await captureVenueFrame(cam) : await fetchTrafficFrame(cam);
    if (!file) return;
    const traceId = newTraceId(`sample-${cam.id}`);
    const d = await detectFrame(file, cam.name, traceId, hints);
    if (!d.frame_usable) {
      fs.unlinkSync(file);
      return;
    }
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
    log(
      `${cam.id}: ${d.event_type ?? "clear"}${d.event_type ? ` (conf ${d.confidence.toFixed(2)}, sev ${d.severity})` : ""} | people=${d.people_count} vehicles=${d.vehicle_count} | ${d.scene_caption.slice(0, 70)}`
    );
  } catch (e) {
    log(`${cam.id}: ERROR`, String(e).slice(0, 200));
  }
}

async function main() {
  const cams = loadCameras().filter((c) => c.kind !== "mobile" && c.intervalSec);
  log(`sampler starting: ${cams.length} cameras (${cams.map((c) => c.id).join(", ")})`);
  // Stagger cameras so API calls spread evenly inside each interval.
  cams.forEach((cam, i) => {
    const interval = (cam.intervalSec as number) * 1000;
    setTimeout(() => {
      let busy = false;
      setInterval(async () => {
        if (busy) return;
        busy = true;
        const hints = await activeWatchHints();
        await processCamera(cam, hints);
        busy = false;
      }, interval);
    }, (i * interval) / cams.length);
  });
}

main();
