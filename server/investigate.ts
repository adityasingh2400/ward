/**
 * investigate.ts — the Investigator agent.
 * Given a triggering observation, drills into ClickHouse history via a
 * read-only SQL tool (SELECT-only, ward_ro user) and produces a structured
 * investigation. Autonomous; bounded at 6 tool calls.
 */
import Anthropic from "@anthropic-ai/sdk";
import { ENV } from "./env";
import { roQuery } from "./db";
import { traced } from "./trace";

const anthropic = new Anthropic({ apiKey: ENV.ANTHROPIC_API_KEY });

export interface Investigation {
  summary: string;
  timeline: { ts: string; note: string }[];
  frequency_note: string;
  recommended_action: string;
  queries_run: number;
}

const SQL_TOOL: Anthropic.Tool = {
  name: "clickhouse_query",
  description:
    "Run a read-only SQL SELECT against the city observation database (ClickHouse). Tables: observations(camera_id, ts, event_type, confidence, severity, description, scene_caption, people_count, vehicle_count, frame_path), incidents(id, ts, camera_id, event_type, severity, status, summary), obs_minute(camera_id, minute, event_type, frames, people, vehicles). Call this when you need history, counts, or baselines to judge how unusual this event is. Keep queries small (LIMIT).",
  input_schema: {
    type: "object",
    properties: { sql: { type: "string", description: "A single SELECT statement. No writes." } },
    required: ["sql"],
  },
};

const RESULT_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "2-3 sentences: what happened, how unusual it is given history, why it matters." },
    timeline: {
      type: "array",
      items: {
        type: "object",
        properties: { ts: { type: "string" }, note: { type: "string" } },
        required: ["ts", "note"],
        additionalProperties: false,
      },
    },
    frequency_note: { type: "string", description: "How often this event type occurred at this camera today/this week." },
    recommended_action: { type: "string", description: "One concrete next step for a city official." },
  },
  required: ["summary", "timeline", "frequency_note", "recommended_action"],
  additionalProperties: false,
} as const;

function isSelectOnly(sql: string): boolean {
  const s = sql.trim().toLowerCase();
  return s.startsWith("select") || s.startsWith("with");
}

export async function investigate(
  trigger: {
    camera_id: string;
    camera_name: string;
    ts: string;
    event_type: string;
    confidence: number;
    severity: number;
    description: string;
  },
  traceId: string
): Promise<Investigation> {
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `An event was just detected and you must investigate it using the observation database before it is escalated to a city official.

Event: ${trigger.event_type} at camera "${trigger.camera_name}" (${trigger.camera_id}) at ${trigger.ts}.
Detector said: "${trigger.description}" (confidence ${trigger.confidence}, severity ${trigger.severity}).

Investigate: recent observations at this camera, whether this event type happened here before today, and current vs typical activity levels. 2-4 queries is usually enough. Then produce your structured report.`,
    },
  ];

  let queriesRun = 0;
  for (let turn = 0; turn < 8; turn++) {
    const resp = await traced(
      {
        traceId,
        name: `investigate-turn-${turn}`,
        model: ENV.AGENT_MODEL,
        input: { trigger: trigger.event_type, turn },
        usageOf: (r: Anthropic.Message) => ({ input_tokens: r.usage.input_tokens, output_tokens: r.usage.output_tokens }),
        outputOf: (r: Anthropic.Message) => r.stop_reason,
      },
      () =>
        anthropic.messages.create({
          model: ENV.AGENT_MODEL,
          max_tokens: 4000,
          system:
            "You are WARD's incident investigator. You verify and contextualize camera-detected civic events using SQL over the observation database. Be fast and factual; never speculate beyond the data. You detect conditions, never identities.",
          tools: [SQL_TOOL],
          output_config: { format: { type: "json_schema", schema: RESULT_SCHEMA as unknown as Record<string, unknown> }, effort: "low" },
          messages,
        })
    );

    if (resp.stop_reason === "refusal") {
      return {
        summary: `${trigger.event_type} detected at ${trigger.camera_name}: ${trigger.description}`,
        timeline: [{ ts: trigger.ts, note: "Event detected" }],
        frequency_note: "investigation unavailable",
        recommended_action: "Review evidence frame",
        queries_run: queriesRun,
      };
    }

    const toolUses = resp.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (toolUses.length === 0) {
      const text = resp.content.find((b): b is Anthropic.TextBlock => b.type === "text");
      if (!text) throw new Error("investigate: no output");
      const parsed = JSON.parse(text.text) as Omit<Investigation, "queries_run">;
      return { ...parsed, queries_run: queriesRun };
    }

    messages.push({ role: "assistant", content: resp.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      const sql = (tu.input as { sql: string }).sql ?? "";
      let content: string;
      if (!isSelectOnly(sql)) {
        content = "ERROR: only SELECT statements are permitted.";
      } else {
        try {
          queriesRun++;
          const rows = await roQuery(sql);
          content = JSON.stringify(rows.slice(0, 50));
        } catch (e) {
          content = `QUERY ERROR: ${String(e).slice(0, 300)}`;
        }
      }
      results.push({ type: "tool_result", tool_use_id: tu.id, content });
    }
    messages.push({ role: "user", content: results });
  }
  throw new Error("investigate: exceeded turn limit");
}
