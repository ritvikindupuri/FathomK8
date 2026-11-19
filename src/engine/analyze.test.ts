import { describe, expect, it } from "vitest";
import { analyze } from "./analyze";
import type { Manifest } from "./parse";
import { parseJsonManifests, parseYamlDocuments } from "./parse";
import { unionScore } from "./score";

function manifest(kind: string, name: string, spec: Record<string, unknown>, opts?: { namespace?: string; annotations?: Record<string, string>; keyCount?: number; committed?: boolean }): Manifest {
  return {
    apiVersion: "v1",
    kind,
    metadata: {
      name,
      namespace: opts?.namespace || "payments",
      labels: {},
      annotations: opts?.annotations || {},
    },
    spec,
    keyCount: opts?.keyCount || 0,
    committed: opts?.committed || false,
  };
}

function deployment(name: string, spec: Record<string, unknown>, namespace = "payments"): Manifest {
  return { ...manifest("Deployment", name, spec, { namespace }), apiVersion: "apps/v1" };
}

function podSpec(name: string, options: { sa?: string; labels?: Record<string, string>; privileged?: boolean; hostPID?: boolean; hostNetwork?: boolean; hostPath?: string; hostPort?: boolean; secret?: string } = {}) {
  return {
    selector: { matchLabels: { app: name } },
    template: {
      metadata: { labels: options.labels || { app: name } },
      spec: {
        serviceAccountName: options.sa || name,
        hostNetwork: options.hostNetwork || undefined,
        hostPID: options.hostPID || undefined,
        containers: [
          {
            name,
            image: "app:1",
            securityContext: options.privileged ? { privileged: true, allowPrivilegeEscalation: true } : { privileged: false, allowPrivilegeEscalation: false, runAsNonRoot: true },
            ports: options.hostPort ? [{ containerPort: 80, hostPort: 80 }] : [],
            env: options.secret ? [{ name: "TOKEN", valueFrom: { secretKeyRef: { name: options.secret, key: "token" } } }] : [],
          },
        ],
        volumes: options.hostPath ? [{ name: "host", hostPath: { path: options.hostPath }, volumeMounts: [] }] : [],
      },
    },
  };
}

describe("union score", () => {
  it("is zero with nothing reachable", () => {
    expect(unionScore([])).toBe(0);
  });

  it("matches a single outcome", () => {
    expect(unionScore([90])).toBe(90);
    expect(unionScore([100])).toBe(100);
  });

  it("grows with a second path and stays below a sum", () => {
    const combined = unionScore([50, 50]);
    expect(combined).toBe(75);
    expect(combined).toBeLessThan(100);
  });
});

describe("blast radius", () => {
  it("treats cluster-admin as total cluster control", () => {
    const result = analyze([
      deployment("reconciler", podSpec("reconciler", { sa: "gitops" })),
      manifest("ClusterRoleBinding", "gitops", {
        subjects: [{ kind: "ServiceAccount", name: "gitops", namespace: "payments" }],
        roleRef: { kind: "ClusterRole", name: "cluster-admin", apiGroup: "rbac.authorization.k8s.io" },
      }, { namespace: "payments" }),
    ]);
    const workload = result.workloads[0];
    expect(workload.score).toBe(100);
    expect(workload.findings.some((finding) => finding.title === "cluster-admin")).toBe(true);
    expect(workload.fixes[0]?.op).toBe("drop-rbac");
    expect(workload.fixes[0]?.scoreAfter).toBe(0);
    expect(workload.fixes[0]?.shrink).toBe(100);
  });

  it("does not score a namespaced pod read as a breakout", () => {
    const result = analyze([
      deployment("checkout", podSpec("checkout")),
      manifest("Role", "view", { rules: [{ apiGroups: [""], resources: ["pods"], verbs: ["get", "list"] }] }),
      manifest("RoleBinding", "view", {
        subjects: [{ kind: "ServiceAccount", name: "checkout", namespace: "payments" }],
        roleRef: { kind: "Role", name: "view", apiGroup: "rbac.authorization.k8s.io" },
      }),
    ]);
    expect(result.score).toBe(0);
  });

  it("ranks a node escape above a single privileged flag", () => {
    const sock = analyze([deployment("checkout", podSpec("checkout", { privileged: true, hostPID: true, hostPath: "/var/run/docker.sock" }))]);
    const priv = analyze([deployment("checkout", podSpec("checkout", { privileged: true }))]);
    expect(sock.score).toBeGreaterThan(priv.score);
    expect(sock.workloads[0].findings[0].title).toBe("Node compromise");
    expect(sock.workloads[0].fixes[0].op).toBe("clear-node");
    expect(sock.workloads[0].fixes[0].shrink).toBeGreaterThan(priv.score);
    expect(sock.workloads[0].fixes[0].scoreAfter).toBe(0);
  });

  it("reaches a vault only when egress is open", () => {
    const vault = manifest("Service", "pci-vault", { selector: { app: "pci-vault" }, ports: [{ port: 8200 }] }, { namespace: "pci" });
    const postgres = manifest("Service", "postgres", { selector: { app: "postgres" }, ports: [{ port: 5432 }] });
    const open = analyze([deployment("checkout", podSpec("checkout", { labels: { app: "checkout" } })), vault, postgres]);
    expect(open.workloads[0].findings.some((finding) => finding.title === "pci-vault")).toBe(true);
    const denied = analyze([
      deployment("checkout", podSpec("checkout", { labels: { app: "checkout", networking: "restricted" } })),
      vault,
      postgres,
      manifest("NetworkPolicy", "deny", {
        podSelector: { matchLabels: { networking: "restricted" } },
        policyTypes: ["Egress"],
        egress: [],
      }),
    ]);
    expect(denied.workloads[0].findings.some((finding) => finding.category === "network")).toBe(false);
    const allowed = analyze([
      deployment("api", podSpec("api", { labels: { app: "payments-api" }, sa: "payments-api" })),
      vault,
      postgres,
      manifest("NetworkPolicy", "api-to-postgres", {
        podSelector: { matchLabels: { app: "payments-api" } },
        policyTypes: ["Egress"],
        egress: [{ to: [{ podSelector: { matchLabels: { app: "postgres" } } }], ports: [{ port: 5432, protocol: "TCP" }] }],
      }),
    ]);
    const titles = allowed.workloads[0].findings.map((finding) => finding.title);
    expect(titles).toContain("postgres");
    expect(titles).not.toContain("pci-vault");
  });

  it("classifies IRSA role names and shows the scoped fix", () => {
    const broad = analyze([
      deployment("payments-api", podSpec("payments-api", { sa: "payments-api" })),
      manifest("ServiceAccount", "payments-api", {}, { annotations: { "eks.amazonaws.com/role-arn": "arn:aws:iam::482133619721:role/payments-administrator" } }),
    ]);
    const read = analyze([
      deployment("payments-api", podSpec("payments-api", { sa: "payments-api" })),
      manifest("ServiceAccount", "payments-api", {}, { annotations: { "eks.amazonaws.com/role-arn": "arn:aws:iam::482133619721:role/payments-receipts-read" } }),
    ]);
    expect(broad.score).toBeGreaterThan(read.score);
    expect(broad.workloads[0].fixes[0].op).toBe("scope-cloud");
    expect(broad.workloads[0].fixes[0].scoreAfter).toBeLessThan(broad.score);
    expect(read.workloads[0].fixes.some((fix) => fix.op === "scope-cloud")).toBe(false);
  });

  it("keeps secret values out of the result and ranks the unmount", () => {
    const manifests = parseYamlDocuments(`
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ledger
  namespace: payments
spec:
  selector:
    matchLabels:
      app: ledger
  template:
    metadata:
      labels:
        app: ledger
        networking: restricted
    spec:
      serviceAccountName: ledger
      containers:
        - name: ledger
          image: app:1
          env:
            - name: TOKEN
              valueFrom:
                secretKeyRef:
                  name: ledger-token
                  key: token
---
apiVersion: v1
kind: Secret
metadata:
  name: ledger-token
  namespace: payments
stringData:
  token: s3cr3t-demo-value
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: deny
  namespace: payments
spec:
  podSelector:
    matchLabels:
      networking: restricted
  policyTypes: ["Egress"]
  egress: []
`);
    const result = analyze(manifests);
    expect(JSON.stringify(result)).not.toContain("s3cr3t-demo-value");
    expect(result.committedSecrets[0]?.name).toBe("ledger-token");
    expect(result.workloads[0].score).toBeGreaterThanOrEqual(64);
    expect(result.workloads[0].fixes[0].op).toBe("unmount-secrets");
    expect(result.workloads[0].fixes[0].patch).not.toContain("s3cr3t-demo-value");
  });

  it("sorts fixes by impact removed", () => {
    const result = analyze([
      deployment("checkout", podSpec("checkout", { privileged: true, hostPID: true, hostPath: "/var/run/docker.sock", hostNetwork: true })),
      manifest("Service", "pci-vault", { selector: { app: "pci-vault" } }, { namespace: "pci" }),
    ]);
    const shrinks = result.workloads[0].fixes.map((fix) => fix.shrink);
    expect(shrinks.length).toBeGreaterThan(1);
    expect([...shrinks].sort((a, b) => b - a)).toEqual(shrinks);
    expect(shrinks[0]).toBeGreaterThan(shrinks[1]);
  });

  it("expands List documents and JSON manifests", () => {
    const listed = parseYamlDocuments(`
apiVersion: v1
kind: List
items:
  - apiVersion: v1
    kind: Namespace
    metadata:
      name: team-a
  - apiVersion: apps/v1
    kind: Deployment
    metadata:
      name: api
      namespace: team-a
    spec:
      template:
        spec:
          containers:
            - name: api
              image: api:1
`);
    expect(listed.map((item) => item.kind)).toEqual(["Namespace", "Deployment"]);
    const json = parseJsonManifests(
      JSON.stringify({
        apiVersion: "v1",
        kind: "List",
        items: [
          {
            apiVersion: "apps/v1",
            kind: "Deployment",
            metadata: { name: "from-json", namespace: "team-a" },
            spec: { template: { spec: { containers: [{ name: "c", image: "c:1" }] } } },
          },
        ],
      }),
      "examples/synthetic-large/rbac.json",
    );
    expect(json[0]?.metadata.name).toBe("from-json");
    expect(json[0]?.sourceFile).toBe("examples/synthetic-large/rbac.json");
  });

  it("scores nodes/proxy and blames hostNetwork on that key", () => {
    const result = analyze([
      deployment("exporter", podSpec("exporter", { sa: "metrics", hostNetwork: true })),
      manifest("ClusterRole", "metrics", { rules: [{ apiGroups: [""], resources: ["nodes/proxy"], verbs: ["get"] }] }),
      manifest("ClusterRoleBinding", "metrics", {
        subjects: [{ kind: "ServiceAccount", name: "metrics", namespace: "payments" }],
        roleRef: { kind: "ClusterRole", name: "metrics" },
      }),
    ]);
    const workload = result.workloads[0];
    const proxy = workload.findings.find((finding) => finding.title === "Kubelet proxy");
    const host = workload.findings.find((finding) => finding.category === "escape");
    expect(proxy?.impact).toBe(82);
    expect(proxy?.token).toBe("nodes/proxy");
    expect(host?.token).toBe("hostNetwork");
    expect(workload.factors.map((factor) => factor.label)).toEqual(expect.arrayContaining(["Kubelet proxy", "Host access"]));
    expect(workload.score).toBe(unionScore([82, 34]));
  });
});
