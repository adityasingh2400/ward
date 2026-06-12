"use client";

import { useEffect, useRef, useState } from "react";
import type { IncidentRow } from "./IncidentCard";

/**
 * IncidentTwin — orbitable 3D reconstruction of a camera's scene (World Labs
 * Marble -> .spz gaussian splat, rendered with Spark) with the incident
 * annotated in-world: pulsing marker + ground ring at the approximate event
 * position (raycast from the camera viewpoint, which is also Marble's
 * generation viewpoint).
 *
 * Twin assets live at public/twins/<camera_id>.spz — generated once per camera
 * (cameras don't move), annotated live per incident.
 */
export default function IncidentTwin({
  cameraId,
  note,
  incident,
}: {
  cameraId: string;
  note: string;
  incident: IncidentRow;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"checking" | "loading" | "ready" | "missing" | "error">("checking");

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | null = null;

    (async () => {
      const url = `/twins/${cameraId}.spz`;
      try {
        const head = await fetch(url, { method: "HEAD" });
        if (!head.ok) {
          setStatus("missing");
          return;
        }
      } catch {
        setStatus("missing");
        return;
      }
      if (disposed || !mountRef.current) return;
      setStatus("loading");

      try {
        const THREE = await import("three");
        const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");
        const { SplatMesh } = await import("@sparkjsdev/spark");
        if (disposed || !mountRef.current) return;

        const mount = mountRef.current;
        const w = mount.clientWidth || 600;
        const h = 260;

        const renderer = new THREE.WebGLRenderer({ antialias: false });
        renderer.setSize(w, h);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        mount.appendChild(renderer.domElement);
        renderer.domElement.className = "twin-canvas";

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(60, w / h, 0.05, 100);
        camera.position.set(0, 0.15, 0.9);

        const splat = new SplatMesh({ url });
        // Marble .spz exports are OpenCV-convention (y down) — flip to three.js space.
        splat.quaternion.set(1, 0, 0, 0);
        scene.add(splat);

        // --- incident annotation: pulsing marker + ground ring -------------
        // Approximate spatial annotation: the generation viewpoint is the
        // camera origin looking down -Z, so we place the marker along that
        // ray at street depth. (bbox-precise raycast is a TOMORROW.md item.)
        const markerPos = new THREE.Vector3(0, -0.35, -1.6);
        const marker = new THREE.Mesh(
          new THREE.SphereGeometry(0.045, 16, 16),
          new THREE.MeshBasicMaterial({ color: 0xff5d5d })
        );
        marker.position.copy(markerPos);
        scene.add(marker);

        const ring = new THREE.Mesh(
          new THREE.RingGeometry(0.09, 0.11, 40),
          new THREE.MeshBasicMaterial({ color: 0xff5d5d, side: THREE.DoubleSide, transparent: true })
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(markerPos.x, markerPos.y - 0.02, markerPos.z);
        scene.add(ring);

        const beam = new THREE.Mesh(
          new THREE.CylinderGeometry(0.004, 0.004, 0.5, 6),
          new THREE.MeshBasicMaterial({ color: 0xff5d5d, transparent: true, opacity: 0.5 })
        );
        beam.position.set(markerPos.x, markerPos.y + 0.25, markerPos.z);
        scene.add(beam);

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.target.copy(markerPos).setY(markerPos.y + 0.1);
        controls.enableDamping = true;
        controls.autoRotate = true;
        controls.autoRotateSpeed = 0.8;
        controls.maxDistance = 3;
        controls.minDistance = 0.3;

        let raf = 0;
        const clock = new THREE.Clock();
        const animate = () => {
          raf = requestAnimationFrame(animate);
          const t = clock.getElapsedTime();
          const pulse = 1 + 0.25 * Math.sin(t * 4);
          marker.scale.setScalar(pulse);
          ring.scale.setScalar(1 + 0.45 * ((t * 0.9) % 1));
          (ring.material as InstanceType<typeof THREE.MeshBasicMaterial>).opacity = 1 - ((t * 0.9) % 1);
          controls.update();
          renderer.render(scene, camera);
        };
        animate();
        setStatus("ready");

        cleanup = () => {
          cancelAnimationFrame(raf);
          controls.dispose();
          splat.dispose();
          renderer.dispose();
          mount.removeChild(renderer.domElement);
        };
      } catch (e) {
        console.error("twin load failed", e);
        setStatus("error");
      }
    })();

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [cameraId]);

  if (status === "missing") {
    return (
      <div className="twin-pending">
        3D twin for this camera not yet generated — drop twins/{cameraId}.spz into public/twins/ (Marble export).
      </div>
    );
  }
  if (status === "error") {
    return <div className="twin-pending">3D twin failed to load.</div>;
  }
  return (
    <div>
      <div ref={mountRef} />
      <div className="caption">
        ◉ {note || incident.summary} — drag to orbit · auto-rotating reconstruction of the scene
      </div>
    </div>
  );
}
