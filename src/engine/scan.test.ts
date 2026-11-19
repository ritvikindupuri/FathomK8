import { execFile } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { promisify } from "util";
import { afterAll, describe, expect, it } from "vitest";
import { scanRepository } from "./scan-repo";

const exec = promisify(execFile);
const root = path.join(os.tmpdir(), `fathom-scan-${process.pid}`);

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function git(dir: string, args: string[]) {
  await exec("git", ["-C", dir, ...args]);
}

async function write(file: string, text: string) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text);
}

async function init(dir: string) {
  await fs.mkdir(dir, { recursive: true });
  await git(dir, ["init", "-b", "main"]);
  await git(dir, ["config", "user.name", "Maya Chen"]);
  await git(dir, ["config", "user.email", "maya@example.com"]);
}

async function commit(dir: string, message: string) {
  await git(dir, ["add", "-A"]);
  await git(dir, ["commit", "-m", message]);
}

function deployment(privileged: boolean): string {
  return `apiVersion: apps/v1
kind: Deployment
metadata:
  name: checkout
  namespace: shop
spec:
  selector:
    matchLabels:
      app: checkout
  template:
    metadata:
      labels:
        app: checkout
    spec:
      containers:
        - name: checkout
          image: checkout:1
          securityContext:
            privileged: ${privileged ? "true" : "false"}
`;
}

describe("scan of a real git history", () => {
  it("renders Helm and Kustomize and blames the commit that introduced the change", async () => {
    const helmDir = path.join(root, "checkout");
    const gitopsDir = path.join(root, "gitops");
    await init(helmDir);
    await init(gitopsDir);

    await write(
      path.join(helmDir, "Chart.yaml"),
      `apiVersion: v2
name: checkout
description: checkout
type: application
version: 0.1.0
appVersion: "1"
`,
    );
    await write(path.join(helmDir, "templates", "deploy.yaml"), deployment(false));
    await write(
      path.join(helmDir, "templates", "secret.yaml"),
      `apiVersion: v1
kind: Secret
metadata:
  name: checkout-token
  namespace: shop
stringData:
  token: fixture-secret-value
`,
    );
    await commit(helmDir, "Add the checkout chart");
    await write(path.join(helmDir, "templates", "deploy.yaml"), deployment(true));
    await commit(helmDir, "Run checkout privileged (#33)");

    await write(
      path.join(gitopsDir, "base", "deployment.yaml"),
      `apiVersion: apps/v1
kind: Deployment
metadata:
  name: node-debug
  namespace: platform
spec:
  selector:
    matchLabels:
      app: node-debug
  template:
    metadata:
      labels:
        app: node-debug
    spec:
      containers:
        - name: debug
          image: debug:1
`,
    );
    await write(
      path.join(gitopsDir, "base", "kustomization.yaml"),
      `resources:
  - deployment.yaml
`,
    );
    await write(
      path.join(gitopsDir, "overlays", "prod", "kustomization.yaml"),
      `resources:
  - ../../base
`,
    );
    await commit(gitopsDir, "Add the debug deployment");
    await write(
      path.join(gitopsDir, "overlays", "prod", "kustomization.yaml"),
      `resources:
  - ../../base
patches:
  - patch: |-
      apiVersion: apps/v1
      kind: Deployment
      metadata:
        name: node-debug
        namespace: platform
      spec:
        template:
          spec:
            containers:
              - name: debug
                securityContext:
                  privileged: true
    target:
      kind: Deployment
      name: node-debug
`,
    );
    await commit(gitopsDir, "Merge pull request #16 from platform/debug-node");

    const helm = await scanRepository({ dir: helmDir, owner: "acme", name: "checkout" });
    const gitops = await scanRepository({ dir: gitopsDir, owner: "acme", name: "gitops" });

    expect(JSON.stringify(helm)).not.toContain("fixture-secret-value");
    expect(helm.notes.some((note) => note.startsWith("Helm"))).toBe(true);
    expect(gitops.notes.some((note) => note.startsWith("Kustomize"))).toBe(true);
    expect(helm.error).toBeUndefined();
    expect(gitops.error).toBeUndefined();
    expect(helm.workloads.map((workload) => workload.name)).toContain("checkout");
    expect(gitops.workloads.map((workload) => workload.name)).toContain("node-debug");

    expect(helm.timeline.map((point) => point.message)).toEqual(["Add the checkout chart", "Run checkout privileged (#33)"]);
    expect(helm.timeline[1].score).toBeGreaterThan(helm.timeline[0].score);
    expect(helm.timeline[1].pr).toBe(33);
    expect(helm.timeline[1].author).toBe("Maya Chen");

    const checkout = helm.workloads.find((workload) => workload.name === "checkout");
    const privileged = checkout?.findings.find((finding) => finding.provenance?.pr === 33);
    expect(privileged?.provenance?.author).toBe("Maya Chen");
    expect(privileged?.provenance?.sha).toMatch(/^[0-9a-f]{7,}$/);

    expect(gitops.timeline[1].score).toBeGreaterThan(gitops.timeline[0].score);
    expect(gitops.timeline[1].pr).toBe(16);
    expect(gitops.timeline[1].message).toBe("Merge pull request #16 from platform/debug-node");
  });
});
