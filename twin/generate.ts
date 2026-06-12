/**
 * twin/generate.ts — World Labs Marble twin generator.
 *
 *   npx tsx twin/generate.ts check                      # verify auth + credits + upload path (FREE)
 *   npx tsx twin/generate.ts <camera_id>                # generate twin from latest frame (COSTS 1 GENERATION)
 *   npx tsx twin/generate.ts <camera_id> --image p.jpg  # generate from explicit image
 *
 * HARD BUDGET: free plan = 4 world generations TOTAL. Each non-check run burns one.
 * Budget plan: venue cam, pothole site, 1 SF street cam (daylight frames), 1 spare.
 * The generated world's .spz downloads to public/twins/<camera_id>.spz where the
 * portal's <IncidentTwin> picks it up automatically.
 */
import fs from "node:fs";
import path from "node:path";
import { ENV } from "../server/env";

const API = "https://api.worldlabs.ai/marble/v1";
const KEY = ENV.WORLDLABS_API_KEY;

async function wl(pathname: string, init?: RequestInit): Promise<Response> {
  return fetch(`${API}${pathname}`, {
    ...init,
    headers: {
      "WLT-Api-Key": KEY!,
      ...(init?.body && typeof init.body === "string" ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
}

async function check() {
  if (!KEY) throw new Error("WORLDLABS_API_KEY missing from .env");
  console.log("1) credits...");
  const cr = await wl("/credits");
  console.log(`   GET /credits -> HTTP ${cr.status}`);
  console.log("  ", (await cr.text()).slice(0, 400));

  console.log("2) prepare_upload (free, validates write auth)...");
  const pu = await wl("/media-assets:prepare_upload", {
    method: "POST",
    body: JSON.stringify({ file_name: "ward-check.jpg", kind: "image", extension: "jpg" }),
  });
  console.log(`   POST media-assets:prepare_upload -> HTTP ${pu.status}`);
  const puBody = await pu.text();
  console.log("  ", puBody.slice(0, 300));
  if (cr.ok && pu.ok) {
    console.log("CHECK: PASS — API path viable. Generation costs 1 of the 4-budget; run only on final daylight frames.");
  } else {
    console.log("CHECK: FAIL — see TOMORROW.md fallback ($20 Standard upgrade or Marble web export).");
    process.exit(1);
  }
}

function latestFrame(cameraId: string): string {
  const dir = path.join(ENV.FRAMES_DIR, cameraId);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".jpg")).sort();
  if (!files.length) throw new Error(`no frames for ${cameraId}`);
  return path.join(dir, files[files.length - 1]);
}

async function generate(cameraId: string, imagePath?: string) {
  if (!KEY) throw new Error("WORLDLABS_API_KEY missing");
  const img = imagePath ?? latestFrame(cameraId);
  const bytes = fs.readFileSync(img);
  console.log(`Generating twin for ${cameraId} from ${img} (${bytes.length} bytes)`);
  console.log("!! This burns 1 of 4 budgeted generations. Ctrl-C within 5s to abort.");
  await new Promise((r) => setTimeout(r, 5000));

  // 1. prepare upload
  const pu = await wl("/media-assets:prepare_upload", {
    method: "POST",
    body: JSON.stringify({ file_name: `${cameraId}.jpg`, kind: "image", extension: "jpg" }),
  });
  if (!pu.ok) throw new Error(`prepare_upload ${pu.status}: ${await pu.text()}`);
  const puJson = (await pu.json()) as { media_asset: { media_asset_id: string }; upload_info: { upload_url: string } };
  console.log("media_asset:", puJson.media_asset.media_asset_id);

  // 2. upload bytes to signed URL
  const up = await fetch(puJson.upload_info.upload_url, {
    method: "PUT",
    headers: { "x-goog-content-length-range": "0,1048576000" },
    body: new Uint8Array(bytes),
  });
  if (!up.ok) throw new Error(`upload ${up.status}: ${await up.text()}`);
  console.log("uploaded.");

  // 3. start generation
  const gen = await wl("/worlds:generate", {
    method: "POST",
    body: JSON.stringify({
      display_name: `WARD twin — ${cameraId}`,
      world_prompt: {
        type: "image",
        image_prompt: { source: "media_asset", media_asset_id: puJson.media_asset.media_asset_id },
      },
    }),
  });
  if (!gen.ok) throw new Error(`generate ${gen.status}: ${await gen.text()}`);
  const genJson = (await gen.json()) as { operation_id?: string; id?: string };
  const opId = genJson.operation_id ?? genJson.id;
  console.log("operation:", opId, "— polling (typically ~5 min)...");

  // 4. poll
  let world: Record<string, unknown> | null = null;
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 10000));
    const op = await wl(`/operations/${opId}`);
    const opJson = (await op.json()) as { done?: boolean; response?: Record<string, unknown>; error?: unknown; metadata?: unknown };
    process.stdout.write(".");
    if (opJson.error) throw new Error(`operation error: ${JSON.stringify(opJson.error)}`);
    if (opJson.done) {
      world = (opJson.response ?? opJson) as Record<string, unknown>;
      break;
    }
  }
  if (!world) throw new Error("generation timed out after 20 min");
  console.log("\nworld:", JSON.stringify(world).slice(0, 500));

  // 5. find the .spz asset URL (prefer 500k for web perf) and download
  const flat = JSON.stringify(world);
  const worldId = (world.id ?? world.world_id ?? (world.world as Record<string, unknown> | undefined)?.id) as string | undefined;
  let spzUrl: string | undefined;
  const urlMatches = [...flat.matchAll(/https?:\/\/[^"\\]+\.spz[^"\\]*/g)].map((m) => m[0]);
  spzUrl = urlMatches.find((u) => u.includes("500")) ?? urlMatches[0];
  if (!spzUrl && worldId) {
    const w = await wl(`/worlds/${worldId}`);
    const wText = await w.text();
    const m2 = [...wText.matchAll(/https?:\/\/[^"\\]+\.spz[^"\\]*/g)].map((m) => m[0]);
    spzUrl = m2.find((u) => u.includes("500")) ?? m2[0];
    if (!spzUrl) {
      fs.writeFileSync(`/tmp/world-${worldId}.json`, wText);
      throw new Error(`no .spz URL found; full world object saved to /tmp/world-${worldId}.json`);
    }
  }
  if (!spzUrl) throw new Error("no .spz URL in world response");
  console.log("downloading splat:", spzUrl.slice(0, 120));
  const splat = await fetch(spzUrl);
  const out = path.join(process.cwd(), "public", "twins", `${cameraId}.spz`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(await splat.arrayBuffer()));
  console.log(`DONE: ${out} (${fs.statSync(out).size} bytes) — portal will render it automatically.`);
}

const [cmd, ...rest] = process.argv.slice(2);
if (!cmd || cmd === "check") {
  check().catch((e) => {
    console.error(e);
    process.exit(1);
  });
} else {
  const imgFlag = rest.indexOf("--image");
  generate(cmd, imgFlag >= 0 ? rest[imgFlag + 1] : undefined).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
