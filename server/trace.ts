/**
 * trace.ts — observability seam.
 *
 * Tonight: appends Langfuse-generation-shaped spans to logs/traces.jsonl.
 * Tomorrow: swap `emit()` internals for the Langfuse SDK (langfuse.generation(...))
 * — the span fields below are 1:1 with Langfuse's generation object, so the swap
 * is mechanical. See TOMORROW.md.
 */
import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";

const LOG_DIR = path.join(process.cwd(), "logs");
const LOG_FILE = path.join(LOG_DIR, "traces.jsonl");
fs.mkdirSync(LOG_DIR, { recursive: true });

export interface GenerationSpan {
  id: string;
  traceId: string;
  name: string;
  startTime: string;
  endTime: string;
  model: string;
  input: unknown;
  output: unknown;
  usage?: { input_tokens?: number; output_tokens?: number };
  metadata?: Record<string, unknown>;
  level?: "DEFAULT" | "WARNING" | "ERROR";
}

function emit(span: GenerationSpan) {
  fs.appendFileSync(LOG_FILE, JSON.stringify(span) + "\n");
}

export function newTraceId(name: string): string {
  return `${name}-${nanoid(10)}`;
}

/** Wrap an LLM call; logs a Langfuse-shaped generation span regardless of outcome. */
export async function traced<T>(
  opts: {
    traceId: string;
    name: string;
    model: string;
    input: unknown;
    metadata?: Record<string, unknown>;
    usageOf?: (result: T) => { input_tokens?: number; output_tokens?: number } | undefined;
    outputOf?: (result: T) => unknown;
  },
  fn: () => Promise<T>
): Promise<T> {
  const start = new Date();
  try {
    const result = await fn();
    emit({
      id: nanoid(12),
      traceId: opts.traceId,
      name: opts.name,
      startTime: start.toISOString(),
      endTime: new Date().toISOString(),
      model: opts.model,
      input: opts.input,
      output: opts.outputOf ? opts.outputOf(result) : undefined,
      usage: opts.usageOf?.(result),
      metadata: opts.metadata,
    });
    return result;
  } catch (err) {
    emit({
      id: nanoid(12),
      traceId: opts.traceId,
      name: opts.name,
      startTime: start.toISOString(),
      endTime: new Date().toISOString(),
      model: opts.model,
      input: opts.input,
      output: String(err),
      metadata: opts.metadata,
      level: "ERROR",
    });
    throw err;
  }
}

/** Read recent spans (portal audit panel + glass-brain widget). */
export function recentSpans(limit = 50): GenerationSpan[] {
  try {
    const lines = fs.readFileSync(LOG_FILE, "utf8").trim().split("\n");
    return lines.slice(-limit).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}
