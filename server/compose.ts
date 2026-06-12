/**
 * compose.ts — the Composer agent.
 * Turns an incident + investigation into a dashboard widget specification.
 * The spec is renderer-agnostic: the portal's widget kit renders it directly,
 * and the OpenUI provider path uses it as grounding context for generated UI.
 * (ui.ts is the provider seam; this produces the canonical data payload.)
 */
import Anthropic from "@anthropic-ai/sdk";
import { ENV } from "./env";
import { query } from "./db";
import { traced } from "./trace";
import { Investigation } from "./investigate";
import { cameraById } from "./cameras";

const anthropic = new Anthropic({ apiKey: ENV.ANTHROPIC_API_KEY });

export interface WidgetSpec {
  headline: string;
  subhead: string;
  severity_label: string;
  widgets: Widget[];
}

export type Widget =
  | { kind: "evidence"; title: string; frame_path: string; caption: string }
  | { kind: "stat"; title: string; value: string; delta: string }
  | { kind: "timeline"; title: string; items: { ts: string; note: string }[] }
  | { kind: "trend"; title: string; series_label: string; points: { t: string; v: number }[] }
  | { kind: "map"; title: string; lat: number; lng: number; label: string }
  | { kind: "action"; title: string; steps: string[] }
  | { kind: "twin"; title: string; camera_id: string; incident_note: string };

/**
 * Flat schema — the structured-outputs compiler rejected the widget-union
 * version as "Schema is too complex". Flat fields also make data fabrication
 * impossible: the model titles/curates; all data values (frames, series,
 * coordinates) are attached deterministically from real sources in code.
 */
const SPEC_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string" },
    subhead: { type: "string" },
    severity_label: { type: "string", enum: ["MONITOR", "NOTABLE", "URGENT", "EMERGENCY"] },
    evidence_caption: { type: "string", description: "caption for the triggering camera frame" },
    stats: {
      type: "array",
      items: {
        type: "object",
        properties: { title: { type: "string" }, value: { type: "string" }, delta: { type: "string" } },
        required: ["title", "value", "delta"],
        additionalProperties: false,
      },
      description: "0-3 key numbers grounded in the investigation",
    },
    timeline: {
      type: "array",
      items: {
        type: "object",
        properties: { ts: { type: "string" }, note: { type: "string" } },
        required: ["ts", "note"],
        additionalProperties: false,
      },
    },
    include_trend: { type: "boolean", description: "include the real activity chart for this camera" },
    trend_title: { type: "string" },
    actions: { type: "array", items: { type: "string" }, description: "concrete next steps for the official" },
    include_twin: { type: "boolean", description: "include 3D scene reconstruction (physical-scene incidents)" },
    twin_note: { type: "string", description: "what the 3D marker indicates" },
  },
  required: ["headline", "subhead", "severity_label", "evidence_caption", "stats", "timeline", "include_trend", "trend_title", "actions", "include_twin", "twin_note"],
  additionalProperties: false,
} as const;

interface FlatSpec {
  headline: string;
  subhead: string;
  severity_label: "MONITOR" | "NOTABLE" | "URGENT" | "EMERGENCY";
  evidence_caption: string;
  stats: { title: string; value: string; delta: string }[];
  timeline: { ts: string; note: string }[];
  include_trend: boolean;
  trend_title: string;
  actions: string[];
  include_twin: boolean;
  twin_note: string;
}

export async function compose(
  incident: {
    id: string;
    ts: string;
    camera_id: string;
    event_type: string;
    severity: number;
    description: string;
    frame_path: string;
  },
  investigation: Investigation,
  traceId: string
): Promise<WidgetSpec> {
  const cam = cameraById(incident.camera_id);

  // Pull a real activity series so the trend widget is backed by live data.
  const series = await query<{ t: string; v: number }>(
    `SELECT toString(minute) AS t, toFloat64(sum(vehicles) + sum(people)) AS v
     FROM obs_minute WHERE camera_id = {cam:String} AND minute > now() - INTERVAL 3 HOUR
     GROUP BY minute ORDER BY minute`,
    { cam: incident.camera_id }
  );

  const resp = await traced(
    {
      traceId,
      name: "compose-dashboard",
      model: ENV.AGENT_MODEL,
      input: { incident: incident.id },
      usageOf: (r: Anthropic.Message) => ({ input_tokens: r.usage.input_tokens, output_tokens: r.usage.output_tokens }),
    },
    () =>
      anthropic.messages.create({
        model: ENV.AGENT_MODEL,
        max_tokens: 6000,
        system: `You are WARD's dashboard composer. Given a civic incident and its investigation, you design the exact dashboard a city official needs for THIS incident — choose only widgets that earn their place, order them by importance. Always include the evidence widget. Include the "twin" widget when a 3D scene reconstruction would help locate/understand the physical scene (potholes, dumping, person down). Use the provided real data series for any trend widget — never invent data points. Severity mapping: 1-2 MONITOR, 3 NOTABLE, 4 URGENT, 5 EMERGENCY.`,
        output_config: { format: { type: "json_schema", schema: SPEC_SCHEMA as unknown as Record<string, unknown> }, effort: "low" },
        messages: [
          {
            role: "user",
            content: `Incident: ${JSON.stringify(incident)}
Camera: ${JSON.stringify(cam ? { name: cam.name, lat: cam.lat, lng: cam.lng, kind: cam.kind } : {})}
Investigation: ${JSON.stringify(investigation)}
Real activity series (last 3h, per minute, people+vehicles): ${JSON.stringify(series)}

Compose the dashboard spec.`,
          },
        ],
      })
  );

  if (resp.stop_reason === "refusal") {
    return {
      headline: `${incident.event_type.replace("_", " ")} at ${cam?.name ?? incident.camera_id}`,
      subhead: incident.description,
      severity_label: incident.severity >= 5 ? "EMERGENCY" : incident.severity >= 4 ? "URGENT" : "NOTABLE",
      widgets: [
        { kind: "evidence", title: "Evidence frame", frame_path: incident.frame_path, caption: incident.description },
        { kind: "timeline", title: "Timeline", items: investigation.timeline },
        { kind: "action", title: "Recommended action", steps: [investigation.recommended_action] },
      ],
    };
  }

  const text = resp.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  if (!text) throw new Error("compose: no output");
  const flat = JSON.parse(text.text) as FlatSpec;

  // Assemble the widget list deterministically: model curates, code attaches
  // all real data (frame path, series, coordinates) — nothing fabricable.
  const widgets: Widget[] = [
    { kind: "evidence", title: "Evidence frame", frame_path: incident.frame_path, caption: flat.evidence_caption || incident.description },
    ...flat.stats.slice(0, 3).map((s): Widget => ({ kind: "stat", title: s.title, value: s.value, delta: s.delta })),
  ];
  if (flat.include_twin) widgets.push({ kind: "twin", title: "Scene", camera_id: incident.camera_id, incident_note: flat.twin_note });
  if (flat.timeline.length) widgets.push({ kind: "timeline", title: "Timeline", items: flat.timeline });
  if (flat.include_trend && series.length > 1)
    widgets.push({ kind: "trend", title: flat.trend_title || "Activity at this camera", series_label: "people+vehicles per minute", points: series });
  if (cam?.lat && cam?.lng) widgets.push({ kind: "map", title: "Location", lat: cam.lat, lng: cam.lng, label: cam.name });
  if (flat.actions.length) widgets.push({ kind: "action", title: "Recommended actions", steps: flat.actions });

  return { headline: flat.headline, subhead: flat.subhead, severity_label: flat.severity_label, widgets };
}
