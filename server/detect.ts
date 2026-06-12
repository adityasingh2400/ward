/**
 * detect.ts — Claude vision on a single frame -> strict Observation JSON.
 * Conservative by design: false positives on stage kill credibility.
 * JSON is guaranteed via forced tool_use (no text parsing).
 */
import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import { ENV } from "./env";
import { traced } from "./trace";

const anthropic = new Anthropic({ apiKey: ENV.ANTHROPIC_API_KEY });

export const EVENT_TYPES = [
  "person_down",
  "pothole",
  "dumping",
  "debris",
  "blocked_lane",
  "flooding",
  "smoke_fire",
  "crowd_surge",
  "stopped_vehicle",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export interface Detection {
  frame_usable: boolean;
  event_type: EventType | null;
  confidence: number;
  severity: number; // 1-5
  description: string;
  scene_caption: string;
  people_count: number;
  vehicle_count: number;
  bbox: number[]; // normalized [x,y,w,h] or []
}

const SYSTEM = `You are WARD's camera frame analyst. WARD reports civic CONDITIONS to city policymakers. You analyze ONE still frame from a public camera (traffic cam, venue cam, or field phone).

HARD RULES:
- You detect CONDITIONS, never identities. Never describe faces, race, gender, or identifying features of any person.
- BE CONSERVATIVE. Only report an event if it is CLEARLY visible in the frame. A missed minor event is acceptable; a false alarm is not. When unsure, event_type = null.
- Traffic cams are low-resolution (320x260) and often night scenes. Headlight streaks, lens flare, fog, and compression artifacts are NOT events. Moving traffic is normal.
- Frames contain overlay banner text (location label, date/time). IGNORE banner text entirely; it is not scene content.
- If the frame shows a "Temporarily Unavailable" placeholder, is solid black, or too degraded to judge: frame_usable=false, event_type=null.
- stopped_vehicle means a vehicle stopped where traffic should flow (shoulder/lane), clearly stationary relative to scene context — not congestion. Congestion is normal, not an event.
- person_down requires a person clearly horizontal/on the ground — not sitting, not bending, not a shadow.
- severity: 1 cosmetic, 2 minor, 3 notable, 4 urgent, 5 emergency.
Always estimate people_count and vehicle_count for the whole frame (0 if none visible).`;

// Structured output schema — enforced by the API via output_config.format.
// (Forced tool_choice is not supported on claude-fable-5; structured outputs are
// the recommended strict-JSON pattern and are schema-guaranteed.)
const OBSERVATION_SCHEMA = {
  type: "object",
  properties: {
    frame_usable: { type: "boolean" },
    event_type: {
      anyOf: [{ type: "string", enum: [...EVENT_TYPES] }, { type: "null" }],
      description: "One of the civic event types, or null if no clear event",
    },
    confidence: { type: "number", description: "0-1, confidence that the event is truly present (0 if none)" },
    severity: { type: "integer", description: "0 none, 1 cosmetic ... 5 emergency" },
    description: { type: "string", description: "One sentence; what & where in frame. Empty if no event." },
    scene_caption: { type: "string", description: "Neutral one-line caption of the overall scene." },
    people_count: { type: "integer" },
    vehicle_count: { type: "integer" },
    bbox: { type: "array", items: { type: "number" }, description: "normalized [x,y,w,h] of event region, or []" },
  },
  required: [
    "frame_usable",
    "event_type",
    "confidence",
    "severity",
    "description",
    "scene_caption",
    "people_count",
    "vehicle_count",
    "bbox",
  ],
  additionalProperties: false,
} as const;

export async function detectFrame(
  framePath: string,
  cameraName: string,
  traceId: string,
  extraWatchHints: string[] = []
): Promise<Detection> {
  const imgB64 = fs.readFileSync(framePath).toString("base64");
  const hints = extraWatchHints.length
    ? `\nActive standing-query hints (still apply the same conservatism): ${extraWatchHints.join("; ")}`
    : "";

  const resp = await traced(
    {
      traceId,
      name: "detect-frame",
      model: ENV.DETECT_MODEL,
      input: { framePath, cameraName, hints: extraWatchHints },
      usageOf: (r: Anthropic.Message) => ({ input_tokens: r.usage.input_tokens, output_tokens: r.usage.output_tokens }),
      outputOf: (r: Anthropic.Message) => r.content.find((b) => b.type === "text"),
    },
    () =>
      anthropic.messages.create({
        model: ENV.DETECT_MODEL,
        max_tokens: 1500,
        system: SYSTEM,
        output_config: { format: { type: "json_schema", schema: OBSERVATION_SCHEMA as unknown as Record<string, unknown> }, effort: "low" },
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: "image/jpeg", data: imgB64 } },
              { type: "text", text: `Camera: ${cameraName}. Analyze this frame.${hints}` },
            ],
          },
        ],
      })
  );

  // Fable 5 safety classifiers can refuse (HTTP 200, stop_reason "refusal").
  // Treat as an unusable frame rather than crashing the sampler loop.
  if (resp.stop_reason === "refusal") {
    return {
      frame_usable: false,
      event_type: null,
      confidence: 0,
      severity: 0,
      description: "",
      scene_caption: "frame skipped (model refusal)",
      people_count: 0,
      vehicle_count: 0,
      bbox: [],
    };
  }

  const text = resp.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  if (!text) throw new Error("detect: model returned no text block");
  const d = JSON.parse(text.text) as Detection;
  // Defensive normalization
  d.event_type = (d.event_type as string) === "" ? null : d.event_type;
  d.confidence = Math.max(0, Math.min(1, Number(d.confidence) || 0));
  d.severity = Math.max(0, Math.min(5, Math.round(Number(d.severity) || 0)));
  d.people_count = Math.max(0, Math.round(Number(d.people_count) || 0));
  d.vehicle_count = Math.max(0, Math.round(Number(d.vehicle_count) || 0));
  if (!Array.isArray(d.bbox)) d.bbox = [];
  return d;
}
