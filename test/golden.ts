/**
 * test/golden.ts — detection quality gate (run: npm run golden).
 * HARD RULE: zero false positives on clean negatives. A missed positive is
 * reported (and critical ones fail the gate); a false alarm always fails.
 */
import fs from "node:fs";
import path from "node:path";
import { detectFrame, EventType } from "../server/detect";
import { newTraceId } from "../server/trace";

interface Expectation {
  file: string;
  expect: "none" | "unusable" | EventType[];
  critical?: boolean; // critical positives must be detected
}

const CASES: Expectation[] = [
  { file: "pos_person_down.jpg", expect: ["person_down"], critical: true },
  { file: "pos_pothole.jpg", expect: ["pothole"], critical: true },
  { file: "pos_dumping.jpg", expect: ["dumping"], critical: true },
  { file: "pos_flooding.jpg", expect: ["flooding"] },
  { file: "pos_debris.jpg", expect: ["debris", "blocked_lane"] },
  { file: "neg_freeway1.jpg", expect: "none" },
  { file: "neg_baybridge.jpg", expect: "none" },
  { file: "neg_cesarchavez.jpg", expect: "none" },
  { file: "neg_280south.jpg", expect: "none" },
  { file: "unusable_placeholder.jpg", expect: "unusable" },
];

async function main() {
  const dir = path.join(process.cwd(), "test", "golden");
  const results: { file: string; expected: string; got: string; conf: number; pass: boolean; fp: boolean }[] = [];

  for (const c of CASES) {
    const fp = path.join(dir, c.file);
    const d = await detectFrame(fp, "golden-test camera", newTraceId("golden"));
    const got = !d.frame_usable ? "unusable" : (d.event_type ?? "none");
    let pass: boolean;
    let falsePositive = false;
    if (c.expect === "none") {
      pass = d.frame_usable && d.event_type === null;
      falsePositive = d.frame_usable && d.event_type !== null;
    } else if (c.expect === "unusable") {
      pass = !d.frame_usable;
    } else {
      pass = d.frame_usable && d.event_type !== null && c.expect.includes(d.event_type);
    }
    results.push({ file: c.file, expected: Array.isArray(c.expect) ? c.expect.join("|") : c.expect, got, conf: d.confidence, pass, fp: falsePositive });
    console.log(`${pass ? "PASS" : "FAIL"}  ${c.file.padEnd(28)} expected=${(Array.isArray(c.expect) ? c.expect.join("|") : c.expect).padEnd(22)} got=${got} (conf ${d.confidence.toFixed(2)})`);
  }

  const falsePositives = results.filter((r) => r.fp);
  const criticalMisses = results.filter((r, i) => !r.pass && CASES[i].critical);
  const passed = results.filter((r) => r.pass).length;

  console.log(`\nGOLDEN: ${passed}/${results.length} passed | false positives: ${falsePositives.length} | critical misses: ${criticalMisses.length}`);

  fs.mkdirSync(path.join(process.cwd(), "docs", "evidence"), { recursive: true });
  fs.writeFileSync(
    path.join(process.cwd(), "docs", "evidence", "golden-results.json"),
    JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2)
  );

  if (falsePositives.length > 0) {
    console.error("GATE FAILED: false positive(s) on clean frames — tighten the detection prompt.");
    process.exit(1);
  }
  if (criticalMisses.length > 0) {
    console.error("GATE FAILED: critical positive(s) missed.");
    process.exit(1);
  }
  console.log("GATE PASSED ✅ (zero false positives, all critical positives detected)");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
