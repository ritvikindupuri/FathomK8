import type { Severity, TimelinePoint } from "@/engine/types";

export function severityColor(severity: Severity): string {
  if (severity === "critical") return "var(--critical)";
  if (severity === "high") return "var(--high)";
  if (severity === "medium") return "var(--medium)";
  return "var(--low)";
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

export function formatDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(date);
}

export function delta(points: { score: number }[]): number | null {
  if (points.length < 2) return null;
  return points[points.length - 1].score - points[points.length - 2].score;
}

export function formatDelta(value: number): string {
  if (value === 0) return "0";
  const sign = value > 0 ? "+" : "−";
  return `${sign}${Math.abs(value)}`;
}

export function unionText(points: number[]): string {
  if (points.length === 0) return "No reachable outcome. The score is 0.";
  if (points.length === 1) return `One outcome, so the score is ${points[0]}.`;
  let survive = 1;
  for (const pointsEach of points) survive *= 1 - Math.min(100, Math.max(0, pointsEach)) / 100;
  return `Union, not a sum: 100 × (1 − Π(1 − p/100)) = ${Math.round(100 * (1 - survive))}.`;
}

export function pointCaption(point: TimelinePoint): string {
  const pr = point.pr ? ` · PR ${point.pr}` : "";
  return `${formatDate(point.date)} · ${point.author} · ${point.message}${pr}`;
}
