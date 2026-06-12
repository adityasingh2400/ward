import { NextRequest, NextResponse } from "next/server";
import { query } from "@/server/db";
import { compileStandingQuery } from "@/server/standing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await query(
    `SELECT id, toString(created) AS created, raw_query, spec FROM watchers WHERE active = 1 ORDER BY created DESC LIMIT 20`
  );
  return NextResponse.json({ watchers: rows });
}

export async function POST(req: NextRequest) {
  const { q } = (await req.json()) as { q?: string };
  if (!q || q.trim().length < 5) {
    return NextResponse.json({ error: "query too short" }, { status: 400 });
  }
  try {
    const { id, spec } = await compileStandingQuery(q.trim());
    return NextResponse.json({ id, spec });
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(0, 200) }, { status: 500 });
  }
}
