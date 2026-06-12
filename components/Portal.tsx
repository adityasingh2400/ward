"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import IncidentCard, { IncidentRow } from "./IncidentCard";

interface Camera {
  id: string;
  name: string;
  kind: string;
  img: string | null;
  observations: number;
  latestFrame: string | null;
}
interface WatcherRow {
  id: string;
  created: string;
  raw_query: string;
  spec: string;
}
interface Span {
  id: string;
  name: string;
  model: string;
  ms: number;
  level: string;
  usage: { input_tokens?: number; output_tokens?: number } | null;
}

function useInterval(fn: () => void, ms: number) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    ref.current();
    const t = setInterval(() => ref.current(), ms);
    return () => clearInterval(t);
  }, [ms]);
}

export default function Portal() {
  const [cams, setCams] = useState<Camera[]>([]);
  const [totalObs, setTotalObs] = useState(0);
  const [incidents, setIncidents] = useState<IncidentRow[]>([]);
  const [watchers, setWatchers] = useState<WatcherRow[]>([]);
  const [spans, setSpans] = useState<Span[]>([]);
  const [q, setQ] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [clock, setClock] = useState("");
  const [camTick, setCamTick] = useState(0);

  useInterval(() => setClock(new Date().toLocaleTimeString()), 1000);
  useInterval(async () => {
    try {
      const r = await fetch("/api/incidents").then((r) => r.json());
      setIncidents(r.incidents ?? []);
    } catch {}
  }, 3000);
  useInterval(async () => {
    try {
      const r = await fetch("/api/cameras").then((r) => r.json());
      setCams(r.cameras ?? []);
      setTotalObs(r.totalObservations ?? 0);
      setCamTick((t) => t + 1);
    } catch {}
  }, 10000);
  useInterval(async () => {
    try {
      const r = await fetch("/api/standing").then((r) => r.json());
      setWatchers(r.watchers ?? []);
    } catch {}
  }, 6000);
  useInterval(async () => {
    try {
      const r = await fetch("/api/traces").then((r) => r.json());
      setSpans(r.spans ?? []);
    } catch {}
  }, 5000);

  const submit = useCallback(async () => {
    if (!q.trim() || submitting) return;
    setSubmitting(true);
    try {
      const r = await fetch("/api/standing", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ q }),
      });
      if (r.ok) setQ("");
      const list = await fetch("/api/standing").then((r) => r.json());
      setWatchers(list.watchers ?? []);
    } finally {
      setSubmitting(false);
    }
  }, [q, submitting]);

  return (
    <>
      <div className="topbar">
        <div className="brand">
          WARD<span>.</span>
        </div>
        <div className="role-chip">SUPERVISOR · DISTRICT 6</div>
        <div className="live-dot" />
        <div style={{ color: "var(--muted)", fontSize: 12 }}>
          {cams.filter((c) => c.kind === "traffic").length} city cameras · live
        </div>
        <div className="meta">
          {totalObs.toLocaleString()} observations in ClickHouse · {clock}
        </div>
      </div>

      <div className="grid">
        {/* LEFT: camera wall */}
        <div className="panel">
          <h2>
            <span className="live-dot" /> Camera network
          </h2>
          <div className="camwall">
            {cams
              .filter((c) => c.kind !== "mobile" || c.latestFrame)
              .map((c) => {
                const src =
                  c.kind === "traffic" && c.img
                    ? `${c.img}?t=${camTick}`
                    : c.latestFrame
                      ? `/api/frame?path=${encodeURIComponent(c.latestFrame)}&t=${camTick}`
                      : null;
                return (
                  <div key={c.id} className={`cam ${c.kind}`}>
                    {src ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={src} alt={c.name} />
                    ) : (
                      <div style={{ height: 74, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)", fontSize: 10 }}>
                        awaiting feed
                      </div>
                    )}
                    <div className="label">{c.name}</div>
                  </div>
                );
              })}
          </div>
        </div>

        {/* CENTER: incident feed */}
        <div>
          {incidents.length === 0 ? (
            <div className="panel">
              <div className="empty">
                <span className="big">⌖</span>
                No incidents yet. The agents are watching {cams.filter((c) => c.kind === "traffic").length} live cameras —
                dashboards are born here the moment something happens.
              </div>
            </div>
          ) : (
            incidents.map((inc) => <IncidentCard key={inc.id} incident={inc} />)
          )}
        </div>

        {/* RIGHT: standing queries + audit */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="panel">
            <h2>Standing queries</h2>
            <div className="body">
              <div className="composeBar">
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submit()}
                  placeholder='e.g. "watch for dumping and collapses near 6th St"'
                />
                <button onClick={submit} disabled={submitting}>
                  {submitting ? "…" : "Watch"}
                </button>
              </div>
              <div style={{ height: 10 }} />
              {watchers.map((w) => {
                let spec: { label?: string; event_types?: string[]; camera_ids?: string[] } = {};
                try {
                  spec = JSON.parse(w.spec);
                } catch {}
                return (
                  <div key={w.id} className="watch">
                    <div className="label">{spec.label ?? w.raw_query}</div>
                    <div className="detail">
                      {(spec.event_types ?? []).join(", ")} ·{" "}
                      {spec.camera_ids?.length ? `${spec.camera_ids.length} cams` : "citywide"}
                    </div>
                    <div className="live">● WATCHING</div>
                  </div>
                );
              })}
              {watchers.length === 0 && (
                <div style={{ color: "var(--muted)", fontSize: 12 }}>
                  Fixed Tier-1 watchers active. Type a request to add your own — the agent compiles it
                  into a live watcher instantly.
                </div>
              )}
            </div>
          </div>

          <div className="panel">
            <h2>Agent audit trail</h2>
            <div className="body" style={{ maxHeight: 320, overflowY: "auto" }}>
              {spans.map((s) => (
                <div key={s.id} className="trace">
                  <span className="name">{s.name}</span>
                  <span>{s.usage?.output_tokens ? `${s.usage.output_tokens}tok` : ""}</span>
                  <span className="ms">{s.ms}ms</span>
                </div>
              ))}
              {spans.length === 0 && <div style={{ color: "var(--muted)", fontSize: 12 }}>No agent activity yet.</div>}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
