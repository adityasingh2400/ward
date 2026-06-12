/**
 * Shared OpenUI component contracts: names, descriptions, prop schemas.
 * - Server (genui route): builds a stub library for prompt generation only.
 * - Client (library.tsx): binds the same contracts to real React renderers.
 * Keeping these identical is what guarantees the generated OpenUI Lang
 * matches what the client can render.
 */
import { z } from "zod/v4";

export const DEFS = {
  Dashboard: {
    description: "Root incident dashboard container with headline and severity. All other components go inside it.",
    props: z.object({
      headline: z.string().describe("Short, specific incident headline"),
      subhead: z.string().describe("One-sentence context for a city official"),
      severity: z.enum(["MONITOR", "NOTABLE", "URGENT", "EMERGENCY"]),
    }),
  },
  EvidenceFrame: {
    description: "The camera frame that triggered the incident. Always include exactly one, first.",
    props: z.object({
      framePath: z.string().describe("frame_path exactly as provided in the incident data"),
      caption: z.string(),
    }),
  },
  Stat: {
    description: "A single key number with context (e.g. occurrences today, minutes since detection).",
    props: z.object({ title: z.string(), value: z.string(), delta: z.string().describe("comparison/context line") }),
  },
  Timeline: {
    description: "Chronological event timeline from the investigation.",
    props: z.object({ title: z.string(), items: z.array(z.object({ ts: z.string(), note: z.string() })) }),
  },
  TrendChart: {
    description: "Line chart of real activity data. Use ONLY the data series provided in the incident context — never invent points.",
    props: z.object({
      title: z.string(),
      seriesLabel: z.string(),
      points: z.array(z.object({ t: z.string(), v: z.number() })),
    }),
  },
  LocationMap: {
    description: "Map pin of the camera location.",
    props: z.object({ lat: z.number(), lng: z.number(), label: z.string() }),
  },
  ActionList: {
    description: "Concrete recommended next steps for the official.",
    props: z.object({ title: z.string(), steps: z.array(z.string()) }),
  },
  SceneTwin: {
    description:
      "Orbitable 3D reconstruction of the camera scene with the incident annotated in-world. Include for physical-scene incidents (pothole, dumping, person_down, debris) when spatial context helps and twin_available is true.",
    props: z.object({
      cameraId: z.string().describe("camera_id exactly as provided"),
      note: z.string().describe("what the marker indicates"),
    }),
  },
} as const;

export type DefName = keyof typeof DEFS;
