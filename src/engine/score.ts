import type { Severity } from "./types";

/** Reachable impact is the complement of every outcome failing independently. */
export function unionScore(impacts: number[]): number {
  let survive = 1;
  for (const impact of impacts) {
    const p = Math.min(100, Math.max(0, impact)) / 100;
    survive *= 1 - p;
  }
  return Math.round(100 * (1 - survive));
}

export function severity(score: number): Severity {
  if (score >= 85) return "critical";
  if (score >= 65) return "high";
  if (score >= 35) return "medium";
  return "low";
}

export function repoScore(scores: number[]): number {
  if (scores.length === 0) return 0;
  return Math.max(...scores);
}
