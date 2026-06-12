"use client";

import { MapContainer, TileLayer, CircleMarker, Popup } from "react-leaflet";
import "leaflet/dist/leaflet.css";

export default function MapWidget({ lat, lng, label }: { lat: number; lng: number; label: string }) {
  return (
    <MapContainer
      center={[lat, lng]}
      zoom={15}
      style={{ height: 160, width: "100%" }}
      attributionControl={false}
      zoomControl={false}
      dragging={false}
      scrollWheelZoom={false}
    >
      <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
      <CircleMarker center={[lat, lng]} radius={10} pathOptions={{ color: "#e7b341", fillColor: "#e7b341", fillOpacity: 0.6 }}>
        <Popup>{label}</Popup>
      </CircleMarker>
    </MapContainer>
  );
}
