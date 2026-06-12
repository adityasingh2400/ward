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

const SPEC_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string" },
    subhead: { type: "string" },
    severity_label: { type: "string", enum: ["MONITOR", "NOTABLE", "URGENT", "EMERGENCY"] },
    widgets: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["evidence", "stat", "timeline", "trend", "map", "action", "twin"] },
          title: { type: "string" },
          frame_path: { type: "string" },
          caption: { type: "string" },
          value: { type: "string" },
          delta: { type: "string" },
          items: {
            type: "array",
            items: {
              type: "object",
              properties: { ts: { type: "string" }, note: { type: "string" } },
              required: ["ts", "note"],
              additionalProperties: false,
            },
          },
          series_label: { type: "string" },
          points: {
            type: "array",
            items: {
              type: "object",
              properties: { t: { type: "string" }, v: { type: "number" } },
              required: ["t", "v"],
              additionalProperties: false,
            },
          },
          lat: { type: "number" },
          lng: { type: "number" },
          label: { type: "string" },
          steps: { type: "array", items: { type: "string" } },
          camera_id: { type: "string" },
          incident_note: { type: "string" },
        },
        required: ["kind", "title"],
        additionalProperties: false,
      },
    },
  },
  required: ["headline", "subhead", "severity_label", "widgets"],
  additionalProperties: false,
} as const;

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
  const spec = JSON.parse(text.text) as WidgetSpec;

  // Guarantee evidence + map presence with real values regardless of model choices.
  if (!spec.widgets.some((w) => w.kind === "evidence")) {
    spec.widgets.unshift({ kind: "evidence", title: "Evidence frame", frame_path: incident.frame_path, caption: incident.description });
  }
  if (cam?.lat && cam?.lng && !spec.widgets.some((w) => w.kind === "map")) {
    spec.widgets.push({ kind: "map", title: "Location", lat: cam.lat, lng: cam.lng, label: cam.name });
  }
  for (const w of spec.widgets) {
    if (w.kind === "evidence") w.frame_path = incident.frame_path; // never let the model point at a different frame
  }
  return spec;
}
