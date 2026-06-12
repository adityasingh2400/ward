/**
 * test/genui-dry.ts — offline validation of the OpenUI generation path.
 * Builds the real system prompt from the shared component library, asks the
 * model to compose a dashboard for a representative incident context, and
 * parses the output with OpenUI's own parser. Nothing is written to the DB —
 * this validates the generate->parse->render contract before it runs live.
 */
import Anthropic from "@anthropic-ai/sdk";
import { createParser } from "@openuidev/react-lang";
import { ENV } from "../server/env";
import { promptLibrary } from "../components/openui/promptLibrary";

const anthropic = new Anthropic({ apiKey: ENV.ANTHROPIC_API_KEY });

const REPRESENTATIVE_CONTEXT = {
  id: "inc-dryrun",
  camera_id: "venue",
  camera: { id: "venue", name: "Civic Plaza Cam (venue)", lat: 37.7905, lng: -122.3989 },
  event_type: "person_down",
  severity: 5,
  summary: "A person is lying motionless on the ground near the plaza entrance.",
  first_ts: "2026-06-12 18:42:11.000",
  evidence_frames: ["frames/venue/1781290931000.jpg"],
  investigation: JSON.stringify({
    summary: "Person detected on the ground 22 seconds ago; no prior person_down events at this camera today; foot traffic was normal until this frame.",
    timeline: [
      { ts: "2026-06-12 18:41:49", note: "Normal scene, 3 people standing" },
      { ts: "2026-06-12 18:42:11", note: "Person detected on ground, others nearby" },
    ],
    frequency_note: "First person_down at this camera in recorded history.",
    recommended_action: "Dispatch medical check immediately; nearest AED in lobby.",
  }),
  twin_available: true,
};

const SERIES = Array.from({ length: 24 }, (_, i) => ({
  t: `2026-06-12 ${String(16 + Math.floor(i / 12)).padStart(2, "0")}:${String((i * 5) % 60).padStart(2, "0")}:00`,
  v: 4 + (i % 5),
}));

async function main() {
  const system = promptLibrary.prompt({
    preamble:
      "You are WARD's interface composer. WARD is a civic intelligence portal for city officials. For each incident you generate the exact dashboard interface that incident needs. Order components by importance. Always start with EvidenceFrame. Include SceneTwin for physical-scene incidents. Use ONLY real data passed to you.",
    additionalRules: [
      "Severity mapping: 1-2 MONITOR, 3 NOTABLE, 4 URGENT, 5 EMERGENCY.",
      "Keep text terse and factual; officials skim.",
      "TrendChart points must come verbatim from the provided activity series (you may subsample evenly).",
    ],
  });
  console.log(`system prompt: ${system.length} chars`);

  const t0 = Date.now();
  const resp = await anthropic.messages.create({
    model: ENV.AGENT_MODEL,
    max_tokens: 8000,
    system,
    output_config: { effort: "low" },
    messages: [
      {
        role: "user",
        content: `Incident data:\n${JSON.stringify(REPRESENTATIVE_CONTEXT, null, 1)}\n\nReal activity series (per-minute people+vehicles, last 3h): ${JSON.stringify(SERIES)}\n\nGenerate the dashboard now.`,
      },
    ],
  });
  if (resp.stop_reason === "refusal") throw new Error("refused");
  const text = resp.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error("no text output");
  console.log(`generated ${text.text.length} chars of OpenUI Lang in ${Date.now() - t0}ms`);
  console.log("--- first 600 chars ---\n" + text.text.slice(0, 600) + "\n---");

  // lang-core's createParser takes the JSON schema, not the Library object
  // (the <Renderer> component handles this conversion internally client-side).
  const parser = createParser(promptLibrary.toJSONSchema() as Parameters<typeof createParser>[0], "Dashboard");
  const result = parser.parse(text.text);
  const errors = result.meta.errors ?? [];
  const critical = errors.filter((e) => e.code === "unknown-component");
  const componentsUsed = new Set<string>();
  const walk = (nodes: unknown[]): void => {
    for (const n of nodes as { component?: string; children?: unknown[] }[]) {
      if (n && typeof n === "object" && n.component) componentsUsed.add(n.component);
      if (n && typeof n === "object" && Array.isArray(n.children)) walk(n.children);
    }
  };
  try {
    walk((result as unknown as { nodes?: unknown[] }).nodes ?? (result as unknown as { tree?: unknown[] }).tree ?? []);
  } catch {}

  console.log(`parse errors: ${errors.length} (critical unknown-component: ${critical.length})`);
  if (errors.length) console.log(JSON.stringify(errors.slice(0, 5), null, 1));
  console.log(`components referenced in output: ${[...componentsUsed].join(", ") || "(tree walk n/a — check raw output above)"}`);
  console.log(`unresolved refs: ${(result.meta.unresolved ?? []).length}`);

  const mustHave = ["EvidenceFrame", "Dashboard"];
  const rawHas = (n: string) => text.text.includes(n);
  const missing = mustHave.filter((m) => !rawHas(m));
  if (critical.length > 0 || missing.length > 0) {
    console.error(`GENUI DRY-RUN FAILED: critical=${critical.length}, missing=${missing.join(",")}`);
    process.exit(1);
  }
  console.log("GENUI DRY-RUN PASSED ✅ — model emits parseable OpenUI Lang using our library");
  process.exit(0);
}

main().catch((e) => {
  console.error("GENUI DRY-RUN ERROR:", e);
  process.exit(1);
});
