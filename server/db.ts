/**
 * db.ts — ClickHouse seam. All reads/writes go through here.
 * Writer uses the default user; the investigator agent must use roQuery()
 * (read-only user ward_ro, created by migrate.ts).
 */
import { createClient, ClickHouseClient } from "@clickhouse/client";
import { ENV } from "./env";

let writer: ClickHouseClient | null = null;
let reader: ClickHouseClient | null = null;

export function chWriter(): ClickHouseClient {
  if (!writer) {
    writer = createClient({
      url: ENV.CLICKHOUSE_HOST,
      username: ENV.CLICKHOUSE_USER,
      password: ENV.CLICKHOUSE_PASSWORD,
      clickhouse_settings: {
        async_insert: 1,
        wait_for_async_insert: 0,
      },
    });
  }
  return writer;
}

export function chReader(): ClickHouseClient {
  if (!reader) {
    reader = createClient({
      url: ENV.CLICKHOUSE_HOST,
      username: "ward_ro",
      password: ENV.CLICKHOUSE_PASSWORD,
    });
  }
  return reader;
}

export interface Observation {
  camera_id: string;
  ts: string; // ISO
  event_type: string; // '' when none
  confidence: number;
  severity: number;
  description: string;
  scene_caption: string;
  people_count: number;
  vehicle_count: number;
  bbox: number[];
  frame_path: string;
}

export async function insertObservation(obs: Observation) {
  await chWriter().insert({
    table: "observations",
    values: [{ ...obs, ts: obs.ts.replace("T", " ").replace("Z", "") }],
    format: "JSONEachRow",
  });
}

export async function insertIncident(row: {
  id: string;
  ts: string;
  camera_id: string;
  event_type: string;
  severity: number;
  summary: string;
  investigation: string;
  evidence_frames: string[];
  ui_spec: string;
}) {
  await chWriter().insert({
    table: "incidents",
    values: [{ ...row, ts: row.ts.replace("T", " ").replace("Z", "") }],
    format: "JSONEachRow",
  });
}

export async function insertWatcher(row: { id: string; created: string; raw_query: string; spec: string; active: number }) {
  await chWriter().insert({
    table: "watchers",
    values: [{ ...row, created: row.created.replace("T", " ").replace("Z", "") }],
    format: "JSONEachRow",
  });
}

/** Generic read query (admin conn) — for app code paths. */
export async function query<T = Record<string, unknown>>(sql: string, params?: Record<string, unknown>): Promise<T[]> {
  const rs = await chWriter().query({ query: sql, query_params: params, format: "JSONEachRow" });
  return (await rs.json()) as T[];
}

/** Read-only query used by the investigator agent's SQL tool. */
export async function roQuery<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  const rs = await chReader().query({ query: sql, format: "JSONEachRow" });
  return (await rs.json()) as T[];
}
