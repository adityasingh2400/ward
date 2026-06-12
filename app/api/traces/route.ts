import { NextResponse } from "next/server";
import { recentSpans } from "@/server/trace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Audit panel: every agent decision is traceable (Langfuse-shaped spans). */
export async function GET() {
  const spans = recentSpans(40).reverse().map((s) => ({
    id: s.id,
    traceId: s.traceId,
    name: s.name,
    model: s.model,
    startTime: s.startTime,
    ms: new Date(s.endTime).getTime() - new Date(s.startTime).getTime(),
    usage: s.usage ?? null,
    level: s.level ?? "DEFAULT",
  }));
  return NextResponse.json({ spans });
}
