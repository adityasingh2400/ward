import fs from "node:fs";
import path from "node:path";

export interface Camera {
  id: string;
  name: string;
  kind: "traffic" | "venue" | "mobile";
  lat: number | null;
  lng: number | null;
  direction: string | null;
  img: string | null;
  intervalSec: number | null;
}

export function loadCameras(): Camera[] {
  const p = path.join(process.cwd(), "cameras.json");
  return JSON.parse(fs.readFileSync(p, "utf8")) as Camera[];
}

export function cameraById(id: string): Camera | undefined {
  return loadCameras().find((c) => c.id === id);
}
