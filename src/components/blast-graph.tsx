"use client";

import type { GraphEdge, GraphNode } from "@/engine/types";
import { useEffect, useRef, useState } from "react";

const SLATE = "#9aa1ab";
const CYAN = "#6ea8fe";

const ICONS: Record<string, string> = {
  workload:
    '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
  admin:
    '<path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z"/><path d="M5 21h14"/>',
  rbac: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  node: '<rect width="20" height="8" x="2" y="2" rx="2"/><rect width="20" height="8" x="2" y="14" rx="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/>',
  secret:
    '<path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r="1" fill="STROKE"/>',
  cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
  network:
    '<rect x="16" y="16" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="9" y="2" width="6" height="6" rx="1"/><path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3"/><path d="M12 12V8"/>',
  account: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
};

function iconUri(name: string, color: string): string {
  const body = (ICONS[name] || ICONS.workload).replaceAll("STROKE", color);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function BlastGraph({
  nodes,
  edges,
  selectedId,
  onSelect,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedId: string | null;
  onSelect: (findingId: string | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onSelectRef = useRef(onSelect);
  const [tip, setTip] = useState<{ x: number; y: number; title: string; body: string } | null>(null);
  const tipRef = useRef(setTip);

  useEffect(() => {
    onSelectRef.current = onSelect;
    tipRef.current = setTip;
  }, [onSelect]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let destroyed = false;
    let cy: { destroy: () => void; resize: () => void; fit: (eles?: undefined, padding?: number) => void } | null = null;
    const font = getComputedStyle(document.body).fontFamily;
    const assets = nodes.filter((node) => node.role === "asset");
    const selected = nodes.find((node) => node.findingId && node.findingId === selectedId);
    const critical = selected || assets.reduce<GraphNode | undefined>((best, node) => (!best || node.impact > best.impact ? node : best), undefined);
    const criticalId = critical?.id || "";

    void (async () => {
      const cytoscapeMod = await import("cytoscape");
      const dagreMod = await import("cytoscape-dagre");
      const cytoscape = cytoscapeMod.default;
      const dagre = dagreMod.default;
      cytoscape.use(dagre);
      if (destroyed || !ref.current) return;
      const instance = cytoscape({
        container: ref.current,
        elements: [
          ...nodes.map((node) => ({
            data: {
              id: node.id,
              label: node.label,
              tip: node.caption,
              icon: node.icon,
              critical: node.id === criticalId ? "yes" : "no",
              findingId: node.findingId || "",
            },
          })),
          ...edges.map((edge, index) => ({
            data: {
              id: `e${index}`,
              source: edge.source,
              target: edge.target,
              label: edge.label,
              critical: edge.target === criticalId ? "yes" : "no",
              findingId: edge.findingId || "",
            },
          })),
        ],
        layout: { name: "dagre", rankDir: "LR", nodeSep: 36, rankSep: 72, edgeSep: 12 } as never,
        minZoom: 0.5,
        maxZoom: 1.8,
        style: [
          {
            selector: "node",
            style: {
              shape: "ellipse",
              width: 44,
              height: 44,
              "background-color": "#161a1e",
              "background-image": (element: { data: (key: string) => string }) => iconUri(element.data("icon"), element.data("critical") === "yes" ? CYAN : SLATE),
              "background-fit": "none",
              "background-width": 20,
              "background-height": 20,
              "border-width": 1,
              "border-color": (element: { data: (key: string) => string }) => (element.data("critical") === "yes" ? CYAN : "#2a313a"),
              color: SLATE,
              "font-size": 11,
              "font-family": font,
              label: "data(label)",
              "text-wrap": "wrap",
              "text-max-width": "96px",
              "text-valign": "bottom",
              "text-halign": "center",
              "text-margin-y": 8,
            },
          },
          {
            selector: "edge",
            style: {
              width: 1,
              "curve-style": "taxi",
              "taxi-direction": "horizontal",
              "target-arrow-shape": "triangle",
              "arrow-scale": 0.7,
              "line-color": (element: { data: (key: string) => string }) => (element.data("critical") === "yes" ? CYAN : "#3a424c"),
              "target-arrow-color": (element: { data: (key: string) => string }) => (element.data("critical") === "yes" ? CYAN : "#3a424c"),
              label: "data(label)",
              "font-size": 10,
              "font-family": font,
              color: SLATE,
              "text-background-color": "#161a1e",
              "text-background-opacity": 1,
              "text-background-padding": "2px",
              "text-rotation": "none",
            },
          },
        ] as never,
      });
      cy = instance;
      instance.fit(undefined, 36);
      instance.on("tap", "node", (event) => {
        const findingId = event.target.data("findingId") as string;
        onSelectRef.current(findingId || null);
      });
      instance.on("tap", (event) => {
        if (event.target === instance) onSelectRef.current(null);
      });
      instance.on("mouseover", "node", (event) => {
        const position = event.renderedPosition as { x: number; y: number } | undefined;
        if (!position) return;
        tipRef.current({
          x: position.x,
          y: position.y,
          title: String(event.target.data("label") || ""),
          body: String(event.target.data("tip") || ""),
        });
      });
      instance.on("mouseout", "node", () => tipRef.current(null));
    })();

    const observer = new ResizeObserver(() => {
      cy?.resize();
      cy?.fit(undefined, 36);
    });
    observer.observe(el);
    return () => {
      destroyed = true;
      observer.disconnect();
      cy?.destroy();
      tipRef.current(null);
    };
  }, [nodes, edges, selectedId]);

  return (
    <div className="relative h-full w-full">
      <div ref={ref} className="h-full w-full" role="img" aria-label="Attack chain" />
      {tip ? (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-md border border-border bg-surface px-2 py-1 text-xs text-foreground"
          style={{ left: tip.x, top: Math.max(8, tip.y - 48) }}
        >
          <div>{tip.title}</div>
          {tip.body ? <div className="text-muted">{tip.body}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
