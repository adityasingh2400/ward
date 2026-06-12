"use client";

import { useEffect, useState } from "react";
import { Renderer } from "@openuidev/react-lang";
import { wardLibrary } from "./openui/library";

/**
 * GenUI — renders an incident's interface from a live OpenUI Lang stream.
 * The interface visibly assembles as the agent writes it.
 */
export default function GenUI({ incidentId, onFail }: { incidentId: string; onFail: () => void }) {
  const [response, setResponse] = useState<string>("");
  const [streaming, setStreaming] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/incidents/${incidentId}/genui`);
        if (!res.ok || !res.body) throw new Error(`genui ${res.status}`);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let acc = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          acc += decoder.decode(value, { stream: true });
          if (cancelled) return;
          setResponse(acc);
        }
        if (!cancelled) {
          setStreaming(false);
          if (acc.trim().length < 10 || acc.includes("genui error")) onFail();
        }
      } catch {
        if (!cancelled) onFail();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [incidentId, onFail]);

  return (
    <div style={{ position: "relative" }}>
      {streaming && (
        <div style={{ position: "absolute", top: 6, right: 10, zIndex: 5, fontSize: 10, color: "var(--gold)", fontFamily: "var(--mono)" }}>
          ⚡ agent is composing this interface…
        </div>
      )}
      <Renderer response={response || null} library={wardLibrary} isStreaming={streaming} />
    </div>
  );
}
