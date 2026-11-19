import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterAll, describe, expect, it } from "vitest";
import { seedGitops, seedPayments } from "../server/demo-repos";
import { scanRepository } from "./scan-repo";

const root = path.join(os.tmpdir(), `fathom-scan-${process.pid}`);

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("rendered demo repositories", () => {
  it("renders Helm and Kustomize, then keeps provenance and a moving timeline", async () => {
    const paymentsDir = path.join(root, "payments-platform");
    const gitopsDir = path.join(root, "platform-gitops");
    await seedPayments(paymentsDir);
    await seedGitops(gitopsDir);

    const payments = await scanRepository({ dir: paymentsDir, owner: "demo", name: "payments-platform", source: "demo" });
    const gitops = await scanRepository({ dir: gitopsDir, owner: "demo", name: "platform-gitops", source: "demo" });

    expect(JSON.stringify(payments)).not.toContain("s3cr3t-demo-value");
    expect(payments.notes.some((note) => note.startsWith("Helm"))).toBe(true);
    expect(gitops.notes.some((note) => note.startsWith("Kustomize"))).toBe(true);
    expect(payments.error).toBeUndefined();
    expect(gitops.error).toBeUndefined();

    const names = payments.workloads.map((workload) => workload.name);
    expect(names.filter((name) => name === "checkout")).toHaveLength(1);
    expect(names).toContain("payments-api");
    expect(names).toContain("pci-vault");

    const timeline = payments.timeline.map((point) => point.score);
    expect(timeline).toHaveLength(5);
    expect(timeline[1]).toBeGreaterThan(timeline[0]);
    expect(timeline[2]).toBeGreaterThan(timeline[1]);
    expect(timeline[3]).toBeGreaterThanOrEqual(timeline[2]);
    expect(timeline[4]).toBeLessThan(timeline[3]);
    expect(timeline[4]).toBeLessThan(timeline[2]);

    const api = payments.workloads.find((workload) => workload.name === "payments-api");
    const cloud = api?.findings.find((finding) => finding.category === "cloud");
    expect(cloud?.provenance?.author).toBe("Maya Chen");
    expect(cloud?.provenance?.pr).toBe(33);
    expect(cloud?.provenance?.sha).toMatch(/^[0-9a-f]{7,}$/);

    const checkout = payments.workloads.find((workload) => workload.name === "checkout");
    expect(checkout?.score).toBeLessThan(30);

    const gitopsTrend = gitops.timeline.map((point) => point.score);
    expect(gitopsTrend[1]).toBeGreaterThan(gitopsTrend[0]);
    expect(gitopsTrend[2]).toBeGreaterThan(gitopsTrend[1]);
    expect(gitopsTrend[3]).toBeLessThan(gitopsTrend[2]);

    const debug = gitops.workloads.find((workload) => workload.name === "node-debug");
    expect(debug).toBeTruthy();
    expect(gitops.workloads.filter((workload) => workload.name === "node-debug")).toHaveLength(1);
    expect(debug!.score).toBeGreaterThan(80);
    expect(debug!.fixes[0].op).toBe("clear-node");
    expect(debug!.fixes[0].shrink).toBeGreaterThan(70);
    expect(debug!.fixes[0].scoreAfter).toBeLessThan(debug!.score);
    expect(debug!.nodes.length).toBeGreaterThan(1);
  });
});
