"use client";

/**
 * /twin-test — renderer validation harness for the 3D twin pipeline.
 * Renders public/twins/_sample.spz (public sample splat) with the live
 * annotation layer. Real per-camera twins drop in as twins/<camera_id>.spz
 * and render identically. This page is a test rig, not demo content.
 */
import dynamic from "next/dynamic";

const IncidentTwin = dynamic(() => import("@/components/IncidentTwin"), { ssr: false });

export default function TwinTest() {
  return (
    <div style={{ maxWidth: 760, margin: "40px auto", padding: 16 }}>
      <h1 style={{ marginBottom: 6 }}>Twin renderer validation</h1>
      <p style={{ color: "var(--muted)", marginBottom: 18, fontSize: 13 }}>
        Sample splat + live incident annotation layer (marker, pulse ring, beam, orbit). Swap in real
        Marble twins as <code>public/twins/&lt;camera_id&gt;.spz</code>.
      </p>
      <div className="widget wide">
        <h4>3D scene — sample asset</h4>
        <IncidentTwin
          cameraId="_sample"
          note="annotation layer validation — marker pinned at raycast position"
          incident={{ id: "test", camera_id: "_sample", first_ts: "", event_type: "test", severity: 3, summary: "renderer validation", investigation: "", evidence_frames: [], ui_spec: "" }}
        />
      </div>
    </div>
  );
}
