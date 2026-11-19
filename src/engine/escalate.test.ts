import { describe, expect, it } from "vitest";
import { analyze } from "./analyze";
import type { Manifest } from "./parse";

function doc(kind: string, name: string, spec: Record<string, unknown>, opts?: { namespace?: string; labels?: Record<string, string> }): Manifest {
  return {
    apiVersion: "v1",
    kind,
    metadata: {
      name,
      namespace: opts?.namespace || "app",
      labels: opts?.labels || {},
      annotations: {},
    },
    spec,
    keyCount: 0,
    committed: false,
  };
}

function deploy(name: string, sa: string, namespace: string): Manifest {
  return doc(
    "Deployment",
    name,
    {
      selector: { matchLabels: { app: name } },
      template: {
        metadata: { labels: { app: name } },
        spec: { serviceAccountName: sa, containers: [{ name, image: "app:1" }] },
      },
    },
    { namespace },
  );
}

function binding(kind: "ClusterRoleBinding" | "RoleBinding", name: string, role: string, roleKind: "ClusterRole" | "Role", subject: string, namespace: string): Manifest {
  return doc(
    kind,
    name,
    {
      roleRef: { apiGroup: "rbac.authorization.k8s.io", kind: roleKind, name: role },
      subjects: [{ kind: "ServiceAccount", name: subject, namespace }],
    },
    { namespace },
  );
}

describe("escalation paths", () => {
  it("keeps a direct cluster-admin binding as the existing factor", () => {
    const result = analyze([
      deploy("api", "api", "app"),
      binding("ClusterRoleBinding", "api-admin", "cluster-admin", "ClusterRole", "api", "app"),
    ]);
    const workload = result.workloads[0];
    expect(workload.score).toBe(100);
    expect(workload.factors.some((factor) => factor.id === "rbac-admin")).toBe(true);
    expect(workload.factors.some((factor) => factor.id === "rbac-chain")).toBe(false);
    expect(workload.findings.some((finding) => finding.title === "cluster-admin")).toBe(true);
  });

  it("follows impersonate to a cluster-admin service account", () => {
    const result = analyze([
      deploy("api", "api", "app"),
      deploy("admin", "admin", "kube-system"),
      doc("ClusterRole", "impersonator", {
        rules: [{ apiGroups: [""], resources: ["serviceaccounts"], verbs: ["impersonate"] }],
      }),
      binding("ClusterRoleBinding", "api-impersonate", "impersonator", "ClusterRole", "api", "app"),
      binding("ClusterRoleBinding", "admin", "cluster-admin", "ClusterRole", "admin", "kube-system"),
    ]);
    const workload = result.workloads.find((item) => item.name === "api");
    expect(workload?.score).toBe(100);
    expect(workload?.factors.some((factor) => factor.id === "rbac-chain" && factor.points === 100)).toBe(true);
    expect(workload?.findings.some((finding) => finding.detail.toLowerCase().includes("impersonate"))).toBe(true);
    expect(workload?.nodes.some((node) => node.label === "Impersonate")).toBe(true);
    expect(workload?.fixes[0]?.op).toBe("drop-rbac");
    expect(workload?.fixes[0]?.scoreAfter).toBeLessThan(100);
  });

  it("does not treat a named secret as every secret", () => {
    const result = analyze([
      deploy("api", "api", "app"),
      doc("Role", "one-secret", {
        rules: [{ apiGroups: [""], resources: ["secrets"], resourceNames: ["only-this"], verbs: ["get"] }],
      }),
      binding("RoleBinding", "one-secret", "one-secret", "Role", "api", "app"),
    ]);
    const workload = result.workloads[0];
    expect(workload.factors.some((factor) => factor.id === "rbac-secrets" || factor.id === "rbac-secrets-ns")).toBe(false);
    expect(workload.score).toBe(0);
  });

  it("expands an aggregated ClusterRole into secret read", () => {
    const result = analyze([
      deploy("api", "api", "app"),
      doc(
        "ClusterRole",
        "leaked",
        { rules: [{ apiGroups: [""], resources: ["secrets"], verbs: ["get", "list"] }] },
        { labels: { "rbac.authorization.k8s.io/aggregate-to-admin": "true" } },
      ),
      doc("ClusterRole", "admin", {
        rules: [],
        aggregationRule: { clusterRoleSelectors: [{ matchLabels: { "rbac.authorization.k8s.io/aggregate-to-admin": "true" } }] },
      }),
      binding("ClusterRoleBinding", "api-admin", "admin", "ClusterRole", "api", "app"),
    ]);
    const workload = result.workloads[0];
    expect(workload.factors.some((factor) => factor.id === "rbac-secrets" && factor.points === 84)).toBe(true);
    expect(result.standing.some((note) => note.title.includes("leaked"))).toBe(true);
  });

  it("reaches cluster admin by binding a new ClusterRoleBinding", () => {
    const result = analyze([
      deploy("api", "api", "app"),
      doc("ClusterRole", "binder", {
        rules: [
          { apiGroups: ["rbac.authorization.k8s.io"], resources: ["clusterroles"], verbs: ["bind"] },
          { apiGroups: ["rbac.authorization.k8s.io"], resources: ["clusterrolebindings"], verbs: ["create"] },
        ],
      }),
      binding("ClusterRoleBinding", "api-bind", "binder", "ClusterRole", "api", "app"),
    ]);
    const workload = result.workloads[0];
    expect(workload.score).toBe(100);
    expect(workload.findings.some((finding) => finding.id.endsWith(":rbac-chain") && finding.detail.toLowerCase().includes("bind"))).toBe(true);
    expect(result.cuts.length).toBeGreaterThan(0);
  });

  it("reports client certificate approval as an exposure, not cluster admin", () => {
    const result = analyze([
      deploy("api", "api", "app"),
      doc("ClusterRole", "certs", {
        rules: [
          { apiGroups: ["certificates.k8s.io"], resources: ["certificatesigningrequests"], verbs: ["create"] },
          { apiGroups: ["certificates.k8s.io"], resources: ["certificatesigningrequests/approval"], verbs: ["update"] },
          { apiGroups: ["certificates.k8s.io"], resources: ["signers"], resourceNames: ["kubernetes.io/kube-apiserver-client"], verbs: ["approve"] },
        ],
      }),
      binding("ClusterRoleBinding", "api-certs", "certs", "ClusterRole", "api", "app"),
    ]);
    const workload = result.workloads[0];
    expect(workload.score).toBe(60);
    expect(workload.factors.some((factor) => factor.id === "rbac-csr")).toBe(true);
    expect(workload.factors.some((factor) => factor.id === "rbac-chain")).toBe(false);
  });

  it("does not walk off a node when Pod Security is restricted, and does when it is unset", () => {
    const shared = [
      deploy("tenant", "tenant", "tenant"),
      deploy("admin", "admin", "kube-system"),
      doc("Role", "maker", { rules: [{ apiGroups: [""], resources: ["pods"], verbs: ["create"] }] }, { namespace: "tenant" }),
      binding("RoleBinding", "maker", "maker", "Role", "tenant", "tenant"),
      binding("ClusterRoleBinding", "admin", "cluster-admin", "ClusterRole", "admin", "kube-system"),
    ];
    const restricted = analyze([
      ...shared,
      doc("Namespace", "tenant", {}, { namespace: "tenant", labels: { "pod-security.kubernetes.io/enforce": "restricted" } }),
    ]);
    const open = analyze([...shared, doc("Namespace", "tenant", {}, { namespace: "tenant" })]);
    const restrictedTenant = restricted.workloads.find((item) => item.name === "tenant");
    const openTenant = open.workloads.find((item) => item.name === "tenant");
    expect(restrictedTenant?.score).toBe(0);
    expect(openTenant?.score).toBe(90);
    expect(openTenant?.factors.some((factor) => factor.id === "rbac-chain" && factor.points === 90)).toBe(true);
  });
});
