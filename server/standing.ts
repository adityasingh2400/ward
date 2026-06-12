/**
 * standing.ts — plain-English standing queries.
 * "watch for dumping and collapses near 6th St" -> active watcher spec.
 */
import Anthropic from "@anthropic-ai/sdk";
import { nanoid } from "nanoid";
import { ENV } from "./env";
import { EVENT_TYPES } from "./detect";
import { loadCameras } from "./cameras";
import { insertWatcher } from "./db";
import { traced, newTraceId } from "./trace";

const anthropic = new Anthropic({ apiKey: ENV.ANTHROPIC_API_KEY });

export interface WatcherSpec {
  label: string;
  event_types: string[];
  camera_ids: string[]; // empty = all cameras
  min_confidence: number;
  hint: string; // extra instruction passed into the frame analyst prompt
}

const SPEC_SCHEMA = {
  type: "object",
  properties: {
    label: { type: "string", description: "Short human label for this watch, e.g. 'Dumping & collapses near 6th St'" },
    event_types: { type: "array", items: { type: "string", enum: [...EVENT_TYPES] } },
    camera_ids: { type: "array", items: { type: "string" }, description: "Subset of camera ids relevant to the request; empty array if citywide" },
    min_confidence: { type: "number", description: "0.5-0.9; higher for noisy/contentious event types" },
    hint: { type: "string", description: "One sentence to add to the vision analyst's attention, phrased conservatively" },
  },
  required: ["label", "event_types", "camera_ids", "min_confidence", "hint"],
  additionalProperties: false,
} as const;

export async function compileStandingQuery(raw: string): Promise<{ id: string; spec: WatcherSpec }> {
  const cams = loadCameras().map((c) => ({ id: c.id, name: c.name, lat: c.lat, lng: c.lng }));
  const traceId = newTraceId("standing-query");

  const resp = await traced(
    {
      traceId,
      name: "compile-standing-query",
      model: ENV.AGENT_MODEL,
      input: { raw },
      usageOf: (r: Anthropic.Message) => ({ input_tokens: r.usage.input_tokens, output_tokens: r.usage.output_tokens }),
    },
    () =>
      anthropic.messages.create({
        model: ENV.AGENT_MODEL,
        max_tokens: 2000,
        system: `You compile a city official's plain-English monitoring request into a watcher spec for WARD. Available event types: ${EVENT_TYPES.join(", ")}. Available cameras (with locations): ${JSON.stringify(cams)}. Map location references to the nearest cameras; if the request is citywide or vague about location, return an empty camera_ids array. Only include event types the system can visually detect; ignore requests for identity tracking (WARD watches conditions, never people's identities).`,
        output_config: { format: { type: "json_schema", schema: SPEC_SCHEMA as unknown as Record<string, unknown> }, effort: "low" },
        messages: [{ role: "user", content: raw }],
      })
  );

  if (resp.stop_reason === "refusal") throw new Error("standing query refused");
  const text = resp.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  if (!text) throw new Error("standing: no output");
  const spec = JSON.parse(text.text) as WatcherSpec;

  const id = `w-${nanoid(8)}`;
  await insertWatcher({ id, created: new Date().toISOString(), raw_query: raw, spec: JSON.stringify(spec), active: 1 });
  return { id, spec };
}
