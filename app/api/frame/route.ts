import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { ENV } from "@/server/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Serve captured frames (frames/ is outside public/). Traversal-guarded. */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams.get("path") ?? "";
  const abs = path.resolve(process.cwd(), p);
  if (!abs.startsWith(path.resolve(ENV.FRAMES_DIR) + path.sep)) {
    return new NextResponse("forbidden", { status: 403 });
  }
  if (!fs.existsSync(abs)) return new NextResponse("not found", { status: 404 });
  return new NextResponse(new Uint8Array(fs.readFileSync(abs)), {
    headers: { "content-type": "image/jpeg", "cache-control": "no-store" },
  });
}
