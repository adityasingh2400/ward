import { config } from "dotenv";
import path from "node:path";

config({ path: path.join(process.cwd(), ".env") });

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name} (check .env)`);
  return v;
}

export const ENV = {
  ANTHROPIC_API_KEY: required("ANTHROPIC_API_KEY"),
  CLICKHOUSE_HOST: required("CLICKHOUSE_HOST"),
  CLICKHOUSE_USER: process.env.CLICKHOUSE_USER ?? "default",
  CLICKHOUSE_PASSWORD: required("CLICKHOUSE_PASSWORD"),
  // Optional — wired tomorrow. Code paths feature-detect on presence.
  THESYS_API_KEY: process.env.THESYS_API_KEY || null,
  WORLDLABS_API_KEY: process.env.WORLDLABS_API_KEY || null,
  LANGFUSE_PUBLIC_KEY: process.env.LANGFUSE_PUBLIC_KEY || null,
  LANGFUSE_SECRET_KEY: process.env.LANGFUSE_SECRET_KEY || null,
  LANGFUSE_HOST: process.env.LANGFUSE_HOST || "https://us.cloud.langfuse.com",
  FIVEONEONE_API_KEY: process.env.FIVEONEONE_API_KEY || null,
  // Models. DETECT_MODEL is the per-frame cost lever (see TOMORROW.md).
  DETECT_MODEL: process.env.DETECT_MODEL ?? "claude-fable-5",
  AGENT_MODEL: process.env.AGENT_MODEL ?? "claude-fable-5",
  // UI generation provider seam: "openui-oss" | "widgetkit" | "c1"
  UI_PROVIDER: process.env.UI_PROVIDER ?? "openui-oss",
  VENUE_CAM: process.env.VENUE_CAM ?? "on",
  FRAMES_DIR: process.env.FRAMES_DIR ?? path.join(process.cwd(), "frames"),
};
