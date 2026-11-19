"use client";

import type { TimelinePoint } from "@/engine/types";
import { formatDay, pointCaption } from "@/lib/format";
import { useEffect, useRef, useState } from "react";

export function ImpactChart({ points }: { points: TimelinePoint[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const lastSha = points.at(-1)?.sha ?? "";
  const [pin, setPin] = useState<{ sha: string; index: number } | null>(null);
  const selected = pin && pin.sha === lastSha && pin.index < points.length ? pin.index : Math.max(0, points.length - 1);

  useEffect(() => {
    const el = ref.current;
    if (!el || points.length === 0) return;
    let chart: { dispose: () => void; resize: () => void } | null = null;
    let disposed = false;
    const font = getComputedStyle(document.body).fontFamily;
    void import("echarts").then((echarts) => {
      if (disposed || !ref.current) return;
      const instance = echarts.init(ref.current, undefined, { renderer: "canvas" });
      chart = instance;
      instance.setOption({
        backgroundColor: "transparent",
        animationDuration: 280,
        grid: { left: 32, right: 8, top: 16, bottom: 28 },
        tooltip: {
          trigger: "axis",
          backgroundColor: "#1c2127",
          borderColor: "#2a313a",
          textStyle: { color: "#e8eaed", fontSize: 12, fontFamily: font },
          formatter: (params: { dataIndex?: number } | { dataIndex?: number }[]) => {
            const first = Array.isArray(params) ? params[0] : params;
            const point = points[first?.dataIndex ?? 0];
            if (!point) return "";
            return `${point.score}<br/>${pointCaption(point)}`;
          },
        },
        xAxis: {
          type: "category",
          data: points.map((point) => formatDay(point.date)),
          axisLine: { lineStyle: { color: "#2a313a" } },
          axisTick: { show: false },
          axisLabel: { color: "#9aa1ab", fontSize: 11, fontFamily: font },
        },
        yAxis: {
          type: "value",
          min: 0,
          max: 100,
          interval: 25,
          axisLabel: { color: "#9aa1ab", fontSize: 11, fontFamily: font },
          splitLine: { lineStyle: { color: "#232a32" } },
        },
        series: [
          {
            type: "line",
            data: points.map((point) => point.score),
            smooth: false,
            symbol: "circle",
            symbolSize: 6,
            lineStyle: { width: 1.5, color: "#6ea8fe" },
            itemStyle: { color: "#6ea8fe", borderColor: "#0f1214", borderWidth: 1.5 },
          },
        ],
      });
      instance.on("click", (params: unknown) => {
        const dataIndex = (params as { dataIndex?: number }).dataIndex;
        if (typeof dataIndex === "number") setPin({ sha: lastSha, index: dataIndex });
      });
    });
    const observer = new ResizeObserver(() => chart?.resize());
    observer.observe(el);
    return () => {
      disposed = true;
      observer.disconnect();
      chart?.dispose();
    };
  }, [points, lastSha]);

  const point = points[selected] || points.at(-1);

  return (
    <div>
      <div ref={ref} className="h-[220px] w-full" />
      {point ? <p className="mt-2 text-xs text-muted">{pointCaption(point)} · impact {point.score}</p> : null}
    </div>
  );
}
