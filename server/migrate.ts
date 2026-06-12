/**
 * migrate.ts — idempotent schema setup for ClickHouse Cloud.
 * Run: npm run migrate
 */
import { createClient } from "@clickhouse/client";
import { ENV } from "./env";

const ddl: string[] = [
  `CREATE TABLE IF NOT EXISTS observations (
    camera_id LowCardinality(String),
    ts DateTime64(3, 'UTC'),
    event_type LowCardinality(String) DEFAULT '',
    confidence Float32 DEFAULT 0,
    severity UInt8 DEFAULT 0,
    description String DEFAULT '',
    scene_caption String DEFAULT '',
    people_count UInt16 DEFAULT 0,
    vehicle_count UInt16 DEFAULT 0,
    bbox Array(Float32) DEFAULT [],
    frame_path String DEFAULT ''
  ) ENGINE = MergeTree ORDER BY (camera_id, ts)`,

  `CREATE TABLE IF NOT EXISTS incidents (
    id String,
    ts DateTime64(3, 'UTC'),
    camera_id LowCardinality(String),
    event_type LowCardinality(String),
    severity UInt8,
    status LowCardinality(String) DEFAULT 'open',
    summary String,
    investigation String DEFAULT '',
    evidence_frames Array(String) DEFAULT [],
    ui_spec String DEFAULT ''
  ) ENGINE = MergeTree ORDER BY (ts)`,

  `CREATE TABLE IF NOT EXISTS watchers (
    id String,
    created DateTime64(3, 'UTC'),
    raw_query String,
    spec String,
    active UInt8 DEFAULT 1
  ) ENGINE = MergeTree ORDER BY (created)`,

  // Per-minute rollups for baselines/trends. SummingMergeTree collapses on merge.
  `CREATE MATERIALIZED VIEW IF NOT EXISTS obs_minute
   ENGINE = SummingMergeTree ORDER BY (camera_id, minute, event_type)
   AS SELECT
     camera_id,
     toStartOfMinute(ts) AS minute,
     event_type,
     count() AS frames,
     sum(people_count) AS people,
     sum(vehicle_count) AS vehicles
   FROM observations
   GROUP BY camera_id, minute, event_type`,
];

async function main() {
  const admin = createClient({
    url: ENV.CLICKHOUSE_HOST,
    username: ENV.CLICKHOUSE_USER,
    password: ENV.CLICKHOUSE_PASSWORD,
  });

  for (const stmt of ddl) {
    await admin.command({ query: stmt });
    console.log("OK:", stmt.split("\n")[0].trim());
  }

  // Read-only user for the investigator agent + portal reads.
  // Same password as admin (hackathon tradeoff, noted in TOMORROW.md) but readonly=1
  // means even a prompt-injected SQL string cannot mutate state.
  try {
    await admin.command({
      query: `CREATE USER IF NOT EXISTS ward_ro IDENTIFIED BY '${ENV.CLICKHOUSE_PASSWORD.replace(/'/g, "\\'")}' SETTINGS readonly = 1`,
    });
    await admin.command({ query: `GRANT SELECT ON default.* TO ward_ro` });
    console.log("OK: read-only user ward_ro");
  } catch (e) {
    console.warn("WARN: could not create ward_ro (cloud perms?). Falling back to admin reads.", String(e).slice(0, 200));
  }

  const ping = await admin.query({ query: "SELECT count() AS n FROM observations", format: "JSONEachRow" });
  console.log("observations rows:", await ping.json());
  await admin.close();
  console.log("MIGRATE: done");
}

main().catch((e) => {
  console.error("MIGRATE FAILED:", e);
  process.exit(1);
});
