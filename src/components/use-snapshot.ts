"use client";

import type { Snapshot } from "@/engine/types";
import { useEffect, useState } from "react";

let memory: Snapshot | null = null;

export function useSnapshot() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(memory);
  const [live, setLive] = useState(true);

  useEffect(() => {
    let closed = false;
    const apply = (next: Snapshot) => {
      if (memory && next.revision < memory.revision) return;
      memory = next;
      if (!closed) setSnapshot(next);
    };
    if (!memory) {
      void fetch("/api/snapshot")
        .then((response) => response.json())
        .then((data: Snapshot) => apply(data))
        .catch(() => undefined);
    }
    const source = new EventSource("/api/stream");
    source.addEventListener("snapshot", (event) => {
      apply(JSON.parse((event as MessageEvent).data) as Snapshot);
    });
    source.addEventListener("viewers", (event) => {
      const viewers = (JSON.parse((event as MessageEvent).data) as { viewers: number }).viewers;
      setSnapshot((current) => {
        if (!current) return current;
        const next = { ...current, viewers };
        memory = next;
        return next;
      });
    });
    source.onopen = () => setLive(true);
    source.onerror = () => setLive(false);
    return () => {
      closed = true;
      source.close();
    };
  }, []);

  return { snapshot, live };
}
