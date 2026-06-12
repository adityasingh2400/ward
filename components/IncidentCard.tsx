"use client";

import dynamic from "next/dynamic";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import type { Widget, WidgetSpec } from "@/server/compose";

const MapWidget = dynamic(() => import("./MapWidget"), { ssr: false });
const IncidentTwin = dynamic(() => import("./IncidentTwin"), { ssr: false });

export interface IncidentRow {
  id: string;
  camera_id: string;
  first_ts: string;
  event_type: string;
  severity: number;
  summary: string;
  investigation: string;
  evidence_frames: string[];
  ui_spec: string;
}

function WidgetView({ w, incident }: { w: Widget; incident: IncidentRow }) {
  switch (w.kind) {
    case "evidence":
      return (
        <div className="widget">
          <h4>{w.title}</h4>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="evidence" src={`/api/frame?path=${encodeURIComponent(w.frame_path)}`} alt={w.caption} />
          <div className="caption">{w.caption}</div>
        </div>
      );
    case "stat":
      return (
        <div className="widget">
          <h4>{w.title}</h4>
          <div className="stat-value">{w.value}</div>
          <div className="stat-delta">{w.delta}</div>
        </div>
      );
    case "timeline":
      return (
        <div className="widget">
          <h4>{w.title}</h4>
          {w.items.map((it, i) => (
            <div key={i} className="tl-item">
              <span className="tl-ts">{it.ts.slice(11, 19) || it.ts}</span>
              <span>{it.note}</span>
            </div>
          ))}
        </div>
      );
    case "trend":
      return (
        <div className="widget wide">
          <h4>
            {w.title} — {w.series_label}
          </h4>
          <ResponsiveContainer width="100%" height={140}>
            <LineChart data={w.points.map((p) => ({ t: p.t.slice(11, 16), v: p.v }))}>
              <XAxis dataKey="t" stroke="#56607a" fontSize={10} interval="preserveStartEnd" />
              <YAxis stroke="#56607a" fontSize={10} width={30} />
              <Tooltip
                contentStyle={{ background: "#11151f", border: "1px solid #232a3b", borderRadius: 6, fontSize: 11 }}
              />
              <Line type="monotone" dataKey="v" stroke="#4da3ff" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      );
    case "map":
      return (
        <div className="widget">
          <h4>{w.title}</h4>
          <MapWidget lat={w.lat} lng={w.lng} label={w.label} />
        </div>
      );
    case "action":
      return (
        <div className="widget">
          <h4>{w.title}</h4>
          {w.steps.map((s, i) => (
            <div key={i} className="action-step">
              {s}
            </div>
          ))}
        </div>
      );
    case "twin":
      return (
        <div className="widget wide">
          <h4>{w.title} — 3D scene reconstruction</h4>
          <IncidentTwin cameraId={w.camera_id} note={w.incident_note} incident={incident} />
        </div>
      );
    default:
      return null;
  }
}

export default function IncidentCard({ incident }: { incident: IncidentRow }) {
  let spec: WidgetSpec | null = null;
  try {
    spec = incident.ui_spec ? (JSON.parse(incident.ui_spec) as WidgetSpec) : null;
  } catch {}

  const when = new Date(incident.first_ts + "Z").toLocaleTimeString();

  if (!spec) {
    // Skeleton phase: detected, agents still investigating/composing.
    return (
      <div className="incident">
        <header>
          <span className="sev NOTABLE">DETECTED</span>
          <h3>{incident.event_type.replace(/_/g, " ")}</h3>
          <span className="when">{when}</span>
        </header>
        <div className="sub">
          {incident.summary} — <em>agents are investigating and composing this dashboard…</em>
        </div>
        <div style={{ padding: 14 }}>
          {incident.evidence_frames?.[0] && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className="evidence"
              style={{ width: "50%", borderRadius: 6 }}
              src={`/api/frame?path=${encodeURIComponent(incident.evidence_frames[0])}`}
              alt="evidence"
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="incident">
      <header>
        <span className={`sev ${spec.severity_label}`}>{spec.severity_label}</span>
        <h3>{spec.headline}</h3>
        <span className="when">{when}</span>
      </header>
      <div className="sub">{spec.subhead}</div>
      <div className="widgets">
        {spec.widgets.map((w, i) => (
          <WidgetView key={i} w={w} incident={incident} />
        ))}
      </div>
    </div>
  );
}
