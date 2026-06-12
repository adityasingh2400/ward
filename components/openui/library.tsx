"use client";

/**
 * Client OpenUI library — binds the shared contracts in defs.ts to real React
 * renderers (recharts, leaflet, Spark 3D twin). Must stay in lockstep with
 * promptLibrary.ts (same names/schemas), which the generation route uses.
 */
import { defineComponent, createLibrary, useRenderNode } from "@openuidev/react-lang";
import dynamic from "next/dynamic";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { z } from "zod/v4";
import { DEFS, DASHBOARD_DEF } from "./defs";

const MapWidget = dynamic(() => import("../MapWidget"), { ssr: false });
const IncidentTwin = dynamic(() => import("../IncidentTwin"), { ssr: false });

type P<K extends keyof typeof DEFS> = z.infer<(typeof DEFS)[K]["props"]>;

const EvidenceFrame = defineComponent({
  name: "EvidenceFrame",
  description: DEFS.EvidenceFrame.description,
  props: DEFS.EvidenceFrame.props,
  component: ({ framePath, caption }: P<"EvidenceFrame">) => (
    <div className="widget">
      <h4>Evidence</h4>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="evidence" src={`/api/frame?path=${encodeURIComponent(framePath)}`} alt={caption} />
      <div className="caption">{caption}</div>
    </div>
  ),
});

const Stat = defineComponent({
  name: "Stat",
  description: DEFS.Stat.description,
  props: DEFS.Stat.props,
  component: ({ title, value, delta }: P<"Stat">) => (
    <div className="widget">
      <h4>{title}</h4>
      <div className="stat-value">{value}</div>
      <div className="stat-delta">{delta}</div>
    </div>
  ),
});

const Timeline = defineComponent({
  name: "Timeline",
  description: DEFS.Timeline.description,
  props: DEFS.Timeline.props,
  component: ({ title, items }: P<"Timeline">) => (
    <div className="widget">
      <h4>{title}</h4>
      {(items ?? []).map((it, i) => (
        <div key={i} className="tl-item">
          <span className="tl-ts">{(it.ts ?? "").slice(11, 19) || it.ts}</span>
          <span>{it.note}</span>
        </div>
      ))}
    </div>
  ),
});

const TrendChart = defineComponent({
  name: "TrendChart",
  description: DEFS.TrendChart.description,
  props: DEFS.TrendChart.props,
  component: ({ title, seriesLabel, points }: P<"TrendChart">) => (
    <div className="widget wide">
      <h4>
        {title} — {seriesLabel}
      </h4>
      <ResponsiveContainer width="100%" height={140}>
        <LineChart data={(points ?? []).map((p) => ({ t: (p.t ?? "").slice(11, 16), v: p.v }))}>
          <XAxis dataKey="t" stroke="#56607a" fontSize={10} interval="preserveStartEnd" />
          <YAxis stroke="#56607a" fontSize={10} width={30} />
          <Tooltip contentStyle={{ background: "#11151f", border: "1px solid #232a3b", borderRadius: 6, fontSize: 11 }} />
          <Line type="monotone" dataKey="v" stroke="#4da3ff" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  ),
});

const LocationMap = defineComponent({
  name: "LocationMap",
  description: DEFS.LocationMap.description,
  props: DEFS.LocationMap.props,
  component: ({ lat, lng, label }: P<"LocationMap">) => (
    <div className="widget">
      <h4>Location</h4>
      <MapWidget lat={lat} lng={lng} label={label} />
    </div>
  ),
});

const ActionList = defineComponent({
  name: "ActionList",
  description: DEFS.ActionList.description,
  props: DEFS.ActionList.props,
  component: ({ title, steps }: P<"ActionList">) => (
    <div className="widget">
      <h4>{title}</h4>
      {(steps ?? []).map((s, i) => (
        <div key={i} className="action-step">
          {s}
        </div>
      ))}
    </div>
  ),
});

const SceneTwin = defineComponent({
  name: "SceneTwin",
  description: DEFS.SceneTwin.description,
  props: DEFS.SceneTwin.props,
  component: ({ cameraId, note }: P<"SceneTwin">) => (
    <div className="widget wide">
      <h4>3D scene reconstruction</h4>
      <IncidentTwin
        cameraId={cameraId}
        note={note}
        incident={{ id: "", camera_id: cameraId, first_ts: "", event_type: "", severity: 0, summary: note, investigation: "", evidence_frames: [], ui_spec: "" }}
      />
    </div>
  ),
});

const leaves = [EvidenceFrame, Stat, Timeline, TrendChart, LocationMap, ActionList, SceneTwin];

function DashboardRenderer({
  headline,
  subhead,
  severity,
  items,
}: {
  headline: string;
  subhead: string;
  severity: string;
  items?: unknown[];
}) {
  const renderNode = useRenderNode();
  return (
    <div className="incident" style={{ marginBottom: 0 }}>
      <header>
        <span className={`sev ${severity}`}>{severity}</span>
        <h3>{headline}</h3>
      </header>
      <div className="sub">{subhead}</div>
      <div className="widgets">
        {(items ?? []).map((node, i) => (
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          <div key={i} style={{ display: "contents" }}>{renderNode(node as any)}</div>
        ))}
      </div>
    </div>
  );
}

const Dashboard = defineComponent({
  name: "Dashboard",
  description: DASHBOARD_DEF.description,
  props: z.object({
    ...DASHBOARD_DEF.baseProps,
    items: z.array(z.union(leaves.map((l) => l.ref) as [z.ZodType, ...z.ZodType[]])).describe("dashboard widgets, ordered by importance"),
  }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component: DashboardRenderer as any,
});

export const wardLibrary = createLibrary({
  components: [Dashboard, ...leaves],
  root: "Dashboard",
});
