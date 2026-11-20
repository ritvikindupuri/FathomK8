import { severity } from "@/engine/score";
import { describe, expect, it } from "vitest";
import { BAND_LEGEND, bandName, factorSentence, routeExplanation } from "./score-copy";

describe("score bands", () => {
  it("follows the scorer: 0–34 low, 35–64 moderate, 65–84 high, 85–100 critical", () => {
    expect(BAND_LEGEND).toContain("0–34 is low");
    expect(BAND_LEGEND).toContain("35–64 is moderate");
    expect(BAND_LEGEND).toContain("65–84 is high");
    expect(BAND_LEGEND).toContain("85–100 is critical");
    for (let score = 0; score <= 100; score += 1) {
      const level = severity(score);
      const name = bandName(score);
      if (score <= 34) expect(level).toBe("low");
      else if (score <= 64) expect(level).toBe("medium");
      else if (score <= 84) expect(level).toBe("high");
      else expect(level).toBe("critical");
      if (level === "low") expect(name).toBe("Low");
      if (level === "medium") expect(name).toBe("Moderate");
      if (level === "high") expect(name).toBe("High");
      if (level === "critical") expect(name).toBe("Critical");
    }
  });

  it("states cluster-admin with the points the factor actually carries", () => {
    expect(factorSentence({ id: "rbac-admin", label: "cluster-admin", points: 100 })).toBe(
      "Can act as cluster admin through Kubernetes permissions (+100)",
    );
  });

  it("explains a chained route in plain language, and only then", () => {
    const text = routeExplanation([{ id: "rbac-chain", label: "Escalation path", points: 90 }]);
    expect(text).toContain("starts from this workload");
    expect(text).toContain("fewest and most reliable steps");
    const lower = (text || "").toLowerCase();
    for (const word of ["dijkstra", "bfs", "graph", "cost", "heuristic"]) expect(lower).not.toContain(word);
    expect(routeExplanation([{ id: "rbac-admin", label: "cluster-admin", points: 100 }])).toBeNull();
  });

  it("does not use the scoring formula", () => {
    const text = factorSentence({ id: "rbac-exec", label: "Pod exec", points: 88 });
    expect(text).not.toContain("Π");
    expect(text.toLowerCase()).not.toContain("union");
  });
});
