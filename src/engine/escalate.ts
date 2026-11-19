import type { Manifest } from "./parse";
import type { NodeIcon, PathCut, StandingNote } from "./types";

/**
 * Shortest path from a workload to cluster-admin.
 * Grant matching follows chained RBAC: bind, escalate, impersonate, pod create,
 * exec, secret and token minting, nodes/proxy, webhooks, aws-auth, and a
 * node-root hop. Paths start at workloads. User and group identities are
 * intermediate hops only.
 */

const GOAL = "CLUSTER_ADMIN";
const NODE_ROOT = "NODE_ROOT";
const RBAC = "rbac.authorization.k8s.io";
const CORE_GROUPS = new Set([
  "",
  "apps",
  "batch",
  "extensions",
  "policy",
  "networking.k8s.io",
  "storage.k8s.io",
  RBAC,
  "admissionregistration.k8s.io",
  "apiextensions.k8s.io",
  "apiregistration.k8s.io",
  "autoscaling",
  "certificates.k8s.io",
  "coordination.k8s.io",
  "discovery.k8s.io",
  "events.k8s.io",
  "flowcontrol.apiserver.k8s.io",
  "node.k8s.io",
  "scheduling.k8s.io",
  "authentication.k8s.io",
  "authorization.k8s.io",
  "metrics.k8s.io",
  "resource.k8s.io",
  "internal.apiserver.k8s.io",
  "snapshot.storage.k8s.io",
]);
const POD_MAKERS: [string, string, string[]][] = [
  ["", "pods", ["create"]],
  ["apps", "deployments", ["create", "update", "patch"]],
  ["apps", "daemonsets", ["create", "update", "patch"]],
  ["apps", "statefulsets", ["create", "update", "patch"]],
  ["apps", "replicasets", ["create", "update", "patch"]],
  ["batch", "jobs", ["create", "update", "patch"]],
  ["batch", "cronjobs", ["create", "update", "patch"]],
  ["", "replicationcontrollers", ["create"]],
];
const SENSITIVE_HOSTPATHS = new Set([
  "/",
  "/etc",
  "/etc/kubernetes",
  "/var/lib/kubelet",
  "/var/lib",
  "/var/run",
  "/run",
  "/proc",
  "/root",
  "/home",
  "/var/log",
  "/sys",
  "/dev",
  "/boot",
  "/lib",
  "/usr",
  "/var",
  "/opt",
]);
const ESCAPE_CAPS = new Set(["SYS_ADMIN", "SYS_MODULE", "SYS_RAWIO", "DAC_READ_SEARCH", "SYS_BOOT", "BPF"]);
const FIX: Record<string, string> = {
  ADMIN: "Replace the wildcard with the specific verbs and resources this identity needs.",
  BIND: "Remove bind on roles, or pin it to the exact low-privilege roles that may be granted.",
  ESCALATE: "Remove the escalate verb. Nothing but a break-glass role should hold it.",
  IMPERSONATE: "Remove impersonate, or pin it to the single user or group a proxy really needs.",
  POD_CREATE: "Drop create and patch on pods and workload controllers, or confine the namespace with Pod Security restricted.",
  EXEC: "Remove pods/exec, pods/attach, and pods/ephemeralcontainers from day-to-day roles.",
  SECRETS_READ: "Remove get, list, and watch on secrets. list returns every secret value too.",
  SECRET_MINT: "Remove create on secrets. A service-account token secret mints a long-lived token.",
  TOKEN_REQUEST: "Remove create on serviceaccounts/token, or pin it to one service account.",
  NODES_PROXY: "Remove nodes/proxy. Monitoring should use nodes/metrics, nodes/stats, or nodes/log.",
  WEBHOOK: "Remove write access to mutating webhooks. Only the controller that owns one should patch it.",
  AWS_AUTH: "Remove write access to the aws-auth configmap in kube-system, or migrate to EKS access entries.",
  DEPUTY: "Limit who can create this operator's custom resources, and give the operator a narrow identity.",
  WL_ESCAPE: "Remove privileged, hostPID, hostPath, and dangerous capabilities, and enforce Pod Security baseline or restricted.",
  NODE_TOKENS: "Keep powerful service accounts off nodes that run tenant or internet-facing workloads.",
};

export interface RoleRule {
  verbs: string[];
  resources: string[];
  groups: string[];
  names: string[];
}

export interface ChainStep {
  label: string;
  caption: string;
  edge: string;
  icon: NodeIcon;
}

export interface EscalationPath {
  impact: number;
  direct: boolean;
  gate: "rbac" | "node";
  detail: string;
  fix: string;
  fixKind: string;
  token: string;
  file?: string;
  steps: ChainStep[];
}

export interface EscalationExposure {
  id: string;
  title: string;
  detail: string;
  impact: number;
  token: string;
  file?: string;
}

export interface WorkloadEscalation {
  path?: EscalationPath;
  exposures: EscalationExposure[];
}

export interface EscalationReport {
  byWorkload: Map<string, WorkloadEscalation>;
  cuts: PathCut[];
  standing: StandingNote[];
  caveat?: string;
}

interface Grant {
  ns: string | null;
  groups: string[];
  resources: string[];
  verbs: string[];
  names: string[] | null;
  via: string;
  file?: string;
  roleFile?: string;
  token: string;
}

interface Hit {
  names: Set<string> | null;
  vias: string[];
  file?: string;
  token: string;
}

interface Hop {
  to: string;
  kind: string;
  text: string;
  how: string;
  via: string;
  cost: number;
  confidence: "certain" | "likely" | "heuristic";
  file?: string;
  token: string;
}

interface Wl {
  key: string;
  id: string;
  ns: string;
  kind: string;
  name: string;
  sa: string;
  escapes: string[];
  file?: string;
}

interface RoleDoc {
  kind: "ClusterRole" | "Role";
  ns: string | null;
  name: string;
  rules: Record<string, unknown>[];
  labels: Record<string, string>;
  selectors: Record<string, unknown>[];
  file?: string;
}

interface Cluster {
  roles: Map<string, RoleDoc>;
  grants: Map<string, Grant[]>;
  sas: Set<string>;
  saByNs: Map<string, Set<string>>;
  users: Set<string>;
  groups: Set<string>;
  namespaces: Map<string, Record<string, string>>;
  allNs: Set<string>;
  workloads: Wl[];
  tokenSecrets: Map<string, Set<string>>;
  secretsSeen: boolean;
  eks: boolean;
  stock: boolean;
  admission: Set<string>;
  builtin: Set<string>;
}

const clusters = new WeakMap<Manifest[], Cluster>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

function strings(value: unknown): string[] {
  return asArray(value).filter((entry): entry is string => typeof entry === "string");
}

function roleKey(kind: string, ns: string | null, name: string): string {
  return kind === "ClusterRole" ? `cluster/${name}` : `${ns || "default"}/${name}`;
}

function saKey(ns: string, name: string): string {
  return `SA:${ns}/${name}`;
}

function costOf(base: number, confidence: Hop["confidence"]): number {
  const extra = confidence === "certain" ? 0 : confidence === "likely" ? 1 : 4;
  return base * 2 + extra;
}

function hop(to: string, kind: string, text: string, how: string, via: string, file?: string, token = "", base = 1, confidence: Hop["confidence"] = "certain"): Hop {
  return { to, kind, text, how, via, cost: costOf(base, confidence), confidence, file, token: token || kind.toLowerCase() };
}

function allows(grant: Grant, verb: string, group: string, resource: string): boolean {
  if (!grant.verbs.includes("*") && !grant.verbs.includes(verb)) return false;
  if (!grant.groups.includes("*") && !grant.groups.includes(group)) return false;
  return grant.resources.some((pattern) => {
    if (pattern === "*" || pattern === resource) return true;
    if (pattern.startsWith("*/") && resource.endsWith(pattern.slice(1))) return true;
    if (pattern.endsWith("/*") && resource.startsWith(pattern.slice(0, -1))) return true;
    return false;
  });
}

function hits(grants: Grant[], verbs: string[], group: string, resource: string, clusterOnly = false): Map<string | null, Hit> {
  const out = new Map<string | null, Hit>();
  for (const grant of grants) {
    if (clusterOnly && grant.ns !== null) continue;
    for (const verb of verbs) {
      if (!allows(grant, verb, group, resource)) continue;
      if (verb === "create" && grant.names && grant.names.length) continue;
      const current = out.get(grant.ns) || { names: new Set<string>(), vias: [], file: grant.roleFile || grant.file, token: grant.token };
      if (!grant.names || grant.names.length === 0) current.names = null;
      else if (current.names) for (const name of grant.names) current.names.add(name);
      if (!current.vias.includes(grant.via)) current.vias.push(grant.via);
      if (!current.file) current.file = grant.roleFile || grant.file;
      out.set(grant.ns, current);
    }
  }
  return out;
}

function expand(cluster: Cluster, found: Map<string | null, Hit>): Map<string, Hit> {
  const out = new Map<string, Hit>();
  const clusterHit = found.get(null);
  for (const ns of cluster.allNs) {
    if (!ns) continue;
    const parts = [clusterHit, found.get(ns)].filter((hit): hit is Hit => Boolean(hit));
    if (!parts.length) continue;
    let names: Set<string> | null = new Set();
    const vias: string[] = [];
    let file: string | undefined;
    let token = "";
    for (const part of parts) {
      if (part.names === null || names === null) names = null;
      else for (const name of part.names) names.add(name);
      for (const via of part.vias) if (!vias.includes(via)) vias.push(via);
      file = file || part.file;
      token = token || part.token;
    }
    out.set(ns, { names, vias, file, token });
  }
  return out;
}

function viaText(vias: string[]): string {
  const unique = [...new Set(vias)];
  return unique.slice(0, 2).join("; ");
}

function isAdminGrant(grants: Grant[]): Grant | undefined {
  return grants.find((grant) => grant.ns === null && grant.names === null && grant.verbs.includes("*") && grant.groups.includes("*") && grant.resources.includes("*"));
}

function selectorMatches(selector: Record<string, unknown>, labels: Record<string, string>): boolean {
  const matchLabels = isRecord(selector.matchLabels) ? selector.matchLabels : {};
  for (const [key, value] of Object.entries(matchLabels)) {
    if (labels[key] !== String(value)) return false;
  }
  const expressions = asArray(selector.matchExpressions).filter(isRecord);
  for (const expression of expressions) {
    const key = typeof expression.key === "string" ? expression.key : "";
    const operator = typeof expression.operator === "string" ? expression.operator : "";
    const values = strings(expression.values);
    const have = key in labels;
    if (operator === "Exists" && !have) return false;
    if (operator === "DoesNotExist" && have) return false;
    if (operator === "In" && !values.includes(labels[key] || "")) return false;
    if (operator === "NotIn" && have && values.includes(labels[key] || "")) return false;
  }
  return Object.keys(matchLabels).length > 0 || expressions.length > 0;
}

function resolveRules(cluster: Cluster, kind: "ClusterRole" | "Role", ns: string | null, name: string, seen = new Set<string>()): Record<string, unknown>[] | null {
  const doc = cluster.roles.get(roleKey(kind, ns, name));
  if (!doc) {
    if (kind === "ClusterRole" && name === "cluster-admin") {
      return [{ apiGroups: ["*"], resources: ["*"], verbs: ["*"] }];
    }
    return null;
  }
  if (seen.has(doc.name + kind)) return doc.rules;
  seen.add(doc.name + kind);
  let rules = [...doc.rules];
  if (kind === "ClusterRole" && doc.selectors.length) {
    for (const other of cluster.roles.values()) {
      if (other.kind !== "ClusterRole" || other.name === name) continue;
      if (!doc.selectors.some((selector) => selectorMatches(selector, other.labels))) continue;
      const nested = resolveRules(cluster, "ClusterRole", null, other.name, seen) || [];
      rules = rules.concat(nested);
    }
  }
  return rules;
}

export function roleRules(manifests: Manifest[], kind: "ClusterRole" | "Role", namespace: string, name: string): RoleRule[] | null {
  const cluster = loadCluster(manifests);
  const raw = resolveRules(cluster, kind, kind === "Role" ? namespace : null, name);
  if (!raw) return null;
  return raw.filter(isRecord).map(toRule);
}

function toRule(rule: Record<string, unknown>): RoleRule {
  return {
    verbs: strings(rule.verbs),
    resources: strings(rule.resources),
    groups: strings(rule.apiGroups),
    names: strings(rule.resourceNames),
  };
}

function grantFrom(rule: Record<string, unknown>, ns: string | null, via: string, file?: string, roleFile?: string, token = ""): Grant {
  const names = strings(rule.resourceNames);
  return {
    ns,
    groups: strings(rule.apiGroups),
    resources: strings(rule.resources),
    verbs: strings(rule.verbs),
    names: names.length ? names : null,
    via,
    file,
    roleFile,
    token: token || strings(rule.resources)[0] || strings(rule.verbs)[0] || "rule",
  };
}

function podSpecOf(manifest: Manifest): Record<string, unknown> | null {
  if (manifest.kind === "Pod") return manifest.spec;
  const spec = manifest.spec;
  if (manifest.kind === "CronJob") {
    const job = isRecord(spec.jobTemplate) ? spec.jobTemplate : {};
    const jobSpec = isRecord(job.spec) ? job.spec : {};
    const template = isRecord(jobSpec.template) ? jobSpec.template : {};
    return isRecord(template.spec) ? template.spec : null;
  }
  const template = isRecord(spec.template) ? spec.template : {};
  return isRecord(template.spec) ? template.spec : null;
}

function escapeReasons(spec: Record<string, unknown>): string[] {
  const reasons: string[] = [];
  if (spec.hostPID === true) reasons.push("hostPID");
  for (const volume of asArray(spec.volumes).filter(isRecord)) {
    const hostPath = isRecord(volume.hostPath) && typeof volume.hostPath.path === "string" ? volume.hostPath.path : "";
    if (!hostPath) continue;
    const path = hostPath.replace(/\/$/, "") || "/";
    if (path.endsWith(".sock") || SENSITIVE_HOSTPATHS.has(path) || path.startsWith("/var/lib/kubelet") || path.startsWith("/etc/kubernetes")) {
      reasons.push(`hostPath ${hostPath}`);
    }
  }
  const containers = [...asArray(spec.containers), ...asArray(spec.initContainers), ...asArray(spec.ephemeralContainers)].filter(isRecord);
  for (const container of containers) {
    const security = isRecord(container.securityContext) ? container.securityContext : {};
    const name = typeof container.name === "string" ? container.name : "container";
    if (security.privileged === true) reasons.push(`privileged container ${name}`);
    const add = strings(isRecord(security.capabilities) ? security.capabilities.add : []).map((cap) => cap.toUpperCase());
    const bad = add.filter((cap) => ESCAPE_CAPS.has(cap));
    if (bad.length) reasons.push(`capability ${bad.join(",")} on ${name}`);
  }
  return [...new Set(reasons)];
}

function loadCluster(manifests: Manifest[]): Cluster {
  const cached = clusters.get(manifests);
  if (cached) return cached;
  const cluster: Cluster = {
    roles: new Map(),
    grants: new Map(),
    sas: new Set(),
    saByNs: new Map(),
    users: new Set(),
    groups: new Set(["system:masters", "system:authenticated", "system:unauthenticated"]),
    namespaces: new Map(),
    allNs: new Set(),
    workloads: [],
    tokenSecrets: new Map(),
    secretsSeen: false,
    eks: false,
    stock: false,
    admission: new Set(),
    builtin: new Set(),
  };
  const addSa = (ns: string, name: string) => {
    cluster.sas.add(`${ns}/${name}`);
    const list = cluster.saByNs.get(ns) || new Set<string>();
    list.add(name);
    cluster.saByNs.set(ns, list);
    cluster.allNs.add(ns);
  };
  for (const manifest of manifests) {
    const name = manifest.metadata.name;
    const ns = manifest.metadata.namespace || "default";
    if (!name) continue;
    if (name.startsWith("eks:") || (manifest.kind === "ServiceAccount" && (name === "aws-node" || name === "eks-vpc-resource-controller"))) cluster.eks = true;
    if (manifest.metadata.labels["kubernetes.io/bootstrapping"] === "rbac-defaults") cluster.stock = true;
    if (manifest.kind === "ClusterRole" || manifest.kind === "Role") {
      const selectors = asArray(isRecord(manifest.spec.aggregationRule) ? manifest.spec.aggregationRule.clusterRoleSelectors : []).filter(isRecord);
      cluster.roles.set(roleKey(manifest.kind, manifest.kind === "Role" ? ns : null, name), {
        kind: manifest.kind,
        ns: manifest.kind === "Role" ? ns : null,
        name,
        rules: asArray(manifest.spec.rules).filter(isRecord),
        labels: manifest.metadata.labels,
        selectors,
        file: manifest.sourceFile,
      });
    } else if (manifest.kind === "ServiceAccount") addSa(ns, name);
    else if (manifest.kind === "Namespace") cluster.namespaces.set(name, manifest.metadata.labels);
    else if (manifest.kind === "Secret") {
      cluster.secretsSeen = true;
      if (manifest.spec.type === "kubernetes.io/service-account-token") {
        const account = manifest.metadata.annotations["kubernetes.io/service-account.name"];
        if (account) {
          const known = cluster.tokenSecrets.get(ns) || new Set<string>();
          known.add(account);
          cluster.tokenSecrets.set(ns, known);
        }
      }
    } else if (["ValidatingAdmissionPolicy", "ValidatingAdmissionPolicyBinding", "ClusterPolicy", "Policy", "ConstraintTemplate"].includes(manifest.kind)) {
      cluster.admission.add(manifest.kind);
    } else if (["Pod", "Deployment", "StatefulSet", "DaemonSet", "Job", "CronJob", "ReplicaSet"].includes(manifest.kind)) {
      if (manifest.kind === "Pod" && asArray(manifest.metadata.annotations.ownerReferences).length) continue;
      const spec = podSpecOf(manifest);
      if (!spec) continue;
      const sa = (typeof spec.serviceAccountName === "string" && spec.serviceAccountName) || (typeof spec.serviceAccount === "string" && spec.serviceAccount) || "default";
      addSa(ns, sa);
      cluster.workloads.push({
        key: `WL:${ns}/${manifest.kind}/${name}`,
        id: `${ns}/${manifest.kind}/${name}`,
        ns,
        kind: manifest.kind,
        name,
        sa,
        escapes: escapeReasons(spec),
        file: manifest.sourceFile,
      });
    }
  }
  for (const manifest of manifests) {
    if (manifest.kind !== "ClusterRoleBinding" && manifest.kind !== "RoleBinding") continue;
    const roleRef = isRecord(manifest.spec.roleRef) ? manifest.spec.roleRef : {};
    const roleName = typeof roleRef.name === "string" ? roleRef.name : "";
    const roleKind = roleRef.kind === "ClusterRole" ? "ClusterRole" : "Role";
    const bindingNs = manifest.kind === "RoleBinding" ? manifest.metadata.namespace || "default" : null;
    const rules = roleName ? resolveRules(cluster, roleKind, roleKind === "Role" ? bindingNs : null, roleName) : null;
    if (!rules) continue;
    const builtin = manifest.metadata.labels["kubernetes.io/bootstrapping"] === "rbac-defaults";
    const bindingName = `${manifest.kind}/${bindingNs ? `${bindingNs}/` : ""}${manifest.metadata.name}`;
    const roleDesc = `${roleKind}/${roleName}`;
    const roleDoc = cluster.roles.get(roleKey(roleKind, roleKind === "Role" ? bindingNs : null, roleName));
    for (const subject of asArray(manifest.spec.subjects).filter(isRecord)) {
      const kind = typeof subject.kind === "string" ? subject.kind : "";
      const subjectName = typeof subject.name === "string" ? subject.name : "";
      if (!subjectName) continue;
      let key = "";
      if (kind === "ServiceAccount") {
        const subjectNs = typeof subject.namespace === "string" && subject.namespace ? subject.namespace : bindingNs || "default";
        key = saKey(subjectNs, subjectName);
        addSa(subjectNs, subjectName);
      } else if (kind === "User") {
        key = `User:${subjectName}`;
        cluster.users.add(subjectName);
      } else if (kind === "Group") {
        key = `Group:${subjectName}`;
        cluster.groups.add(subjectName);
      }
      if (!key) continue;
      if (builtin && key.startsWith("SA:")) cluster.builtin.add(key);
      const list = cluster.grants.get(key) || [];
      for (const rule of rules.filter(isRecord)) {
        list.push(grantFrom(rule, bindingNs, `${roleDesc} via ${bindingName}`, manifest.sourceFile, roleDoc?.file, roleName));
      }
      cluster.grants.set(key, list);
    }
    if (bindingNs) cluster.allNs.add(bindingNs);
  }
  clusters.set(manifests, cluster);
  return cluster;
}

function groupsOf(key: string): string[] {
  if (key.startsWith("SA:")) {
    const ns = key.slice(3).split("/")[0];
    return ["system:serviceaccounts", `system:serviceaccounts:${ns}`, "system:authenticated"];
  }
  if (key.startsWith("User:")) return key.slice(5) === "system:anonymous" ? ["system:unauthenticated"] : ["system:authenticated"];
  return [];
}

function effectiveGrants(cluster: Cluster, key: string, cache: Map<string, Grant[]>): Grant[] {
  const cached = cache.get(key);
  if (cached) return cached;
  let grants: Grant[] = [];
  if (key.startsWith("ROLE:")) {
    const body = key.slice(5);
    const at = body.lastIndexOf("@");
    const scope = body.slice(at + 1);
    const parts = body.slice(0, at).split("/");
    const ns = scope === "*" ? null : scope;
    if (parts[0] === "ClusterRole") {
      const rules = resolveRules(cluster, "ClusterRole", null, parts[1]) || [];
      const doc = cluster.roles.get(roleKey("ClusterRole", null, parts[1]));
      grants = rules.filter(isRecord).map((rule) => grantFrom(rule, ns, `ClusterRole/${parts[1]}`, doc?.file, doc?.file, parts[1]));
    } else {
      const rules = resolveRules(cluster, "Role", parts[1], parts[2]) || [];
      const doc = cluster.roles.get(roleKey("Role", parts[1], parts[2]));
      grants = rules.filter(isRecord).map((rule) => grantFrom(rule, ns, `Role/${parts[1]}/${parts[2]}`, doc?.file, doc?.file, parts[2]));
    }
  } else if (key.startsWith("NSADMIN:")) {
    const ns = key.slice(8);
    grants = [{ ns, groups: ["*"], resources: ["*"], verbs: ["*"], names: null, via: `admin of namespace ${ns}`, token: "cluster-admin" }];
  } else {
    grants = [...(cluster.grants.get(key) || [])];
    for (const group of groupsOf(key)) {
      for (const grant of cluster.grants.get(`Group:${group}`) || []) {
        grants.push({ ...grant, via: `${grant.via} (inherited from group ${group})` });
      }
    }
    if (key === "Group:system:masters") {
      grants.push({ ns: null, groups: ["*"], resources: ["*"], verbs: ["*"], names: null, via: "built-in group system:masters", token: "system:masters" });
    }
  }
  cache.set(key, grants);
  return grants;
}

function admits(cluster: Cluster, ns: string): { ok: boolean; confidence: Hop["confidence"]; note: string } {
  const labels = cluster.namespaces.get(ns);
  const enforce = labels?.["pod-security.kubernetes.io/enforce"];
  if (enforce === "baseline" || enforce === "restricted") return { ok: false, confidence: "certain", note: `namespace ${ns} enforces Pod Security ${enforce}` };
  if (!labels) return { ok: true, confidence: "likely", note: `no Namespace object for ${ns}, so no Pod Security label is visible` };
  if (enforce === "privileged") return { ok: true, confidence: "certain", note: `namespace ${ns} enforces Pod Security privileged` };
  return { ok: true, confidence: "likely", note: `namespace ${ns} has no Pod Security enforce label` };
}

function identityEdges(cluster: Cluster, key: string, shallow: boolean, grants: Grant[], edges: (key: string, shallow: boolean) => Hop[]): Hop[] {
  if (!grants.length) return [];
  const admin = isAdminGrant(grants);
  if (admin) return [hop(GOAL, "ADMIN", "already holds cluster admin", "Every verb on every resource, cluster-wide.", admin.via, admin.roleFile || admin.file, admin.token, 0)];
  const out: Hop[] = [];
  const clusterBind = hits(grants, ["bind"], RBAC, "clusterroles", true).get(null);
  const clusterBinding = hits(grants, ["create"], RBAC, "clusterrolebindings", true).get(null);
  const roleBindings = expand(cluster, hits(grants, ["create"], RBAC, "rolebindings"));
  if (clusterBind && clusterBinding) {
    const names = clusterBind.names ? [...clusterBind.names] : null;
    const via = viaText([...clusterBind.vias, ...clusterBinding.vias]);
    const adminNamed = (name: string) => Boolean(isAdminGrant(effectiveGrants(cluster, `ROLE:ClusterRole/${name}@*`, new Map())));
    if (!names || names.some(adminNamed)) {
      out.push(hop(GOAL, "BIND", "bind cluster-admin through a new ClusterRoleBinding", "bind lets you reference a role you do not hold. Creating the binding completes it.", via, clusterBind.file, clusterBind.token));
    } else if (!shallow) {
      for (const name of names) {
        const roleNode = `ROLE:ClusterRole/${name}@*`;
        if (cluster.roles.has(roleKey("ClusterRole", null, name)) && edges(roleNode, true).length) {
          out.push(hop(roleNode, "BIND", `bind ClusterRole ${name} cluster-wide`, "Bind is pinned, and that role is itself powerful.", via, clusterBind.file, name));
        }
      }
    }
  }
  if (clusterBind) {
    for (const [ns, hit] of roleBindings) {
      const names = clusterBind.names ? [...clusterBind.names] : null;
      const via = viaText([...clusterBind.vias, ...hit.vias]);
      const adminNamed = (name: string) => Boolean(isAdminGrant(effectiveGrants(cluster, `ROLE:ClusterRole/${name}@*`, new Map())));
      if (!names || names.some(adminNamed)) {
        out.push(hop(`NSADMIN:${ns}`, "BIND", `bind cluster-admin inside namespace ${ns}`, "A RoleBinding to cluster-admin is admin of that namespace.", via, clusterBind.file, clusterBind.token));
      }
    }
  }
  if (!shallow) {
    const roleBind = expand(cluster, hits(grants, ["bind"], RBAC, "roles"));
    for (const [ns, hit] of roleBind) {
      const created = roleBindings.get(ns);
      if (!created) continue;
      for (const role of cluster.roles.values()) {
        if (role.kind !== "Role" || role.ns !== ns) continue;
        if (hit.names && !hit.names.has(role.name)) continue;
        const roleNode = `ROLE:Role/${ns}/${role.name}@${ns}`;
        if (edges(roleNode, true).length) {
          out.push(hop(roleNode, "BIND", `bind Role ${role.name} in ${ns}`, "bind on roles plus creating a RoleBinding.", viaText([...hit.vias, ...created.vias]), hit.file, role.name));
        }
      }
    }
  }
  const escalate = hits(grants, ["escalate"], RBAC, "clusterroles", true).get(null);
  if (escalate) {
    const update = hits(grants, ["update", "patch"], RBAC, "clusterroles", true).get(null);
    const create = hits(grants, ["create"], RBAC, "clusterroles", true).get(null);
    if (update) {
      out.push(hop(GOAL, "ESCALATE", "patch a ClusterRole you hold and add every permission", "escalate turns off the check that stops you granting permissions you lack.", viaText([...escalate.vias, ...update.vias]), update.file, "escalate"));
    } else if (create && clusterBinding) {
      out.push(hop(GOAL, "ESCALATE", "create a ClusterRole with every permission and bind it", "escalate plus create on clusterroles and clusterrolebindings.", viaText([...escalate.vias, ...create.vias, ...clusterBinding.vias]), create.file, "escalate"));
    }
  }
  const escalateNs = expand(cluster, hits(grants, ["escalate"], RBAC, "roles"));
  const updateNs = expand(cluster, hits(grants, ["update", "patch"], RBAC, "roles"));
  const createNs = expand(cluster, hits(grants, ["create"], RBAC, "roles"));
  for (const [ns, hit] of escalateNs) {
    if (updateNs.has(ns) || (createNs.has(ns) && roleBindings.has(ns))) {
      out.push(hop(`NSADMIN:${ns}`, "ESCALATE", `rewrite a Role in ${ns} with every permission`, "escalate on roles is scoped to that namespace.", viaText(hit.vias), hit.file, "escalate"));
    }
  }

  const users = hits(grants, ["impersonate"], "", "users", true).get(null);
  const groups = hits(grants, ["impersonate"], "", "groups", true).get(null);
  const accounts = expand(cluster, hits(grants, ["impersonate"], "", "serviceaccounts"));
  if (users && !shallow) {
    const targets = new Set<string>();
    if (!users.names) {
      for (const user of cluster.users) targets.add(`User:${user}`);
      for (const [ns, names] of cluster.saByNs) for (const name of names) targets.add(saKey(ns, name));
    } else {
      for (const name of users.names) {
        if (name.startsWith("system:serviceaccount:")) {
          const parts = name.split(":");
          if (parts.length === 4) targets.add(saKey(parts[2], parts[3]));
        } else targets.add(`User:${name}`);
      }
    }
    targets.delete(key);
    for (const target of targets) {
      out.push(hop(target, "IMPERSONATE", `impersonate ${target.replace("SA:", "service account ").replace("User:", "user ")}`, "The API server then authorizes the request as that identity.", viaText(users.vias), users.file, "impersonate"));
    }
  }
  if (groups && (users || accounts.size)) {
    const names = groups.names ? [...groups.names] : [...cluster.groups];
    for (const name of names) {
      if (shallow && name !== "system:masters") continue;
      const suffix = name === "system:masters" ? " (system:masters is cluster admin)" : "";
      out.push(hop(`Group:${name}`, "IMPERSONATE", `impersonate group ${name}${suffix}`, "Impersonating a group also needs permission to impersonate a user.", viaText(groups.vias), groups.file, "impersonate"));
    }
  }
  if (!shallow) {
    for (const [ns, hit] of accounts) {
      const names = hit.names ? [...hit.names] : [...(cluster.saByNs.get(ns) || [])];
      for (const name of names) {
        out.push(hop(saKey(ns, name), "IMPERSONATE", `impersonate service account ${ns}/${name}`, "impersonate on service accounts.", viaText(hit.vias), hit.file, "impersonate"));
      }
    }
  }

  const makers = new Map<string, Hit & { resource: string }>();
  for (const [group, resource, verbs] of POD_MAKERS) {
    for (const [ns, hit] of expand(cluster, hits(grants, verbs, group, resource))) {
      if (!makers.has(ns)) makers.set(ns, { ...hit, resource });
    }
  }
  const namespaceUpdate = hits(grants, ["update", "patch"], "", "namespaces", true).get(null);
  for (const [ns, hit] of makers) {
    if (!shallow) {
      for (const name of cluster.saByNs.get(ns) || []) {
        out.push(hop(saKey(ns, name), "POD_CREATE", `run a pod as ${ns}/${name}`, `Set serviceAccountName to ${name}. The token is mounted in the container.`, viaText(hit.vias), hit.file, hit.token));
      }
    }
    const admission = admits(cluster, ns);
    if (admission.ok) {
      out.push(hop(NODE_ROOT, "POD_CREATE", `schedule a host-level pod in ${ns}`, `${admission.note}. A privileged pod, hostPID, or a sensitive hostPath is root on the node.`, viaText(hit.vias), hit.file, hit.token, 1, admission.confidence));
    } else if (namespaceUpdate && (!namespaceUpdate.names || namespaceUpdate.names.has(ns))) {
      out.push(hop(NODE_ROOT, "POD_CREATE", `relabel ${ns} and schedule a host-level pod`, `${admission.note}, and this identity can also update namespaces.`, viaText([...hit.vias, ...namespaceUpdate.vias]), hit.file, hit.token, 2, "likely"));
    }
  }

  if (!shallow) {
    const execHits = new Map<string, Hit & { resource: string }>();
    for (const [resource, verbs] of [
      ["pods/exec", ["create"]],
      ["pods/attach", ["create"]],
      ["pods/ephemeralcontainers", ["update", "patch"]],
    ] as [string, string[]][]) {
      for (const [ns, hit] of expand(cluster, hits(grants, verbs, "", resource))) {
        if (!execHits.has(ns)) execHits.set(ns, { ...hit, resource });
      }
    }
    for (const [ns, hit] of execHits) {
      for (const workload of cluster.workloads) {
        if (workload.ns !== ns) continue;
        const verb = hit.resource.split("/")[1];
        out.push(hop(workload.key, "EXEC", `${verb} into ${workload.kind}/${workload.name} in ${ns}`, "A shell in that pod can read its token or reach its node.", viaText(hit.vias), hit.file, hit.resource));
      }
    }
    for (const [ns, hit] of expand(cluster, hits(grants, ["get", "list", "watch"], "", "secrets"))) {
      if (hit.names) continue;
      const known = cluster.tokenSecrets.get(ns);
      const targets = cluster.secretsSeen ? [...(known || [])] : known ? [...known] : [...(cluster.saByNs.get(ns) || [])];
      const confidence: Hop["confidence"] = known && known.size ? "certain" : "likely";
      for (const name of targets) {
        out.push(hop(saKey(ns, name), "SECRETS_READ", `read secrets in ${ns} for the token of ${name}`, known && known.size ? "A service-account token secret in this namespace holds that token." : "Assumes a long-lived service account token secret lives in this namespace.", viaText(hit.vias), hit.file, "secrets", known && known.size ? 1 : 2, confidence));
      }
    }
    for (const [ns, hit] of expand(cluster, hits(grants, ["create"], "", "secrets"))) {
      for (const name of cluster.saByNs.get(ns) || []) {
        out.push(hop(saKey(ns, name), "SECRET_MINT", `create a token secret for ${ns}/${name}`, "A secret of type kubernetes.io/service-account-token is filled in by the controller.", viaText(hit.vias), hit.file, "secrets"));
      }
    }
    for (const [ns, hit] of expand(cluster, hits(grants, ["create"], "", "serviceaccounts/token"))) {
      const names = hit.names ? [...hit.names] : [...(cluster.saByNs.get(ns) || [])];
      for (const name of names) {
        out.push(hop(saKey(ns, name), "TOKEN_REQUEST", `request a token for ${ns}/${name}`, "TokenRequest returns a bearer token for that service account.", viaText(hit.vias), hit.file, "serviceaccounts/token"));
      }
    }
    const proxy = hits(grants, ["get", "create", "update", "patch"], "", "nodes/proxy", true).get(null);
    if (proxy) {
      for (const workload of cluster.workloads) {
        out.push(hop(workload.key, "NODES_PROXY", `reach ${workload.kind}/${workload.name} through the kubelet`, "nodes/proxy can open a shell in a pod on that node. This is likely, not certain: the kubelet may still refuse it.", viaText(proxy.vias), proxy.file, "nodes/proxy", 2, "likely"));
      }
    }
  }

  const webhook = hits(grants, ["create", "update", "patch"], "admissionregistration.k8s.io", "mutatingwebhookconfigurations", true).get(null);
  if (webhook) {
    out.push(hop(GOAL, "WEBHOOK", "register a mutating webhook that rewrites pods", "The webhook can add a host-level container to pods, including ones created by cluster admin. Likely, because the webhook must be reachable.", viaText(webhook.vias), webhook.file, "mutatingwebhookconfigurations", 2, "likely"));
  }
  for (const [ns, hit] of expand(cluster, hits(grants, ["update", "patch", "create"], "", "configmaps"))) {
    if (ns === "kube-system" && (!hit.names || hit.names.has("aws-auth")) && (cluster.eks || !cluster.stock)) {
      out.push(hop(GOAL, "AWS_AUTH", "edit aws-auth and map an IAM role to system:masters", "On EKS clusters that still use aws-auth, this is a direct cluster-admin grant. Likely when the cluster is EKS or the input is not stock Kubernetes bootstrap.", viaText(hit.vias), hit.file, "aws-auth", 1, "likely"));
    }
  }
  if (!shallow) {
    for (const [operator, groups] of operatorGroups(cluster, grantsOf(cluster))) {
      if (operator === key) continue;
      const writable = groups.filter((group) => grants.some((grant) => (grant.groups.includes(group) || grant.groups.includes("*")) && grant.names === null && grant.verbs.some((verb) => ["create", "update", "patch", "*"].includes(verb))));
      if (!writable.length) continue;
      out.push(hop(operator, "DEPUTY", `write ${writable.slice(0, 3).join(", ")} resources that ${operator.replace("SA:", "")} reconciles`, "Heuristic: the operator acts on those objects with its own wider permissions. Confirm the operator before treating this as a breakout.", "custom resource write", undefined, writable[0], 3, "heuristic"));
    }
  }
  return out;
}

function grantsOf(cluster: Cluster): (key: string) => Grant[] {
  const cache = new Map<string, Grant[]>();
  return (key: string) => effectiveGrants(cluster, key, cache);
}

const operatorCache = new WeakMap<Cluster, Map<string, string[]>>();

function operatorGroups(cluster: Cluster, grantsFor: (key: string) => Grant[]): Map<string, string[]> {
  const cached = operatorCache.get(cluster);
  if (cached) return cached;
  const out = new Map<string, string[]>();
  for (const id of cluster.sas) {
    const key = `SA:${id}`;
    const grants = grantsFor(key);
    if (!grants.length || isAdminGrant(grants)) continue;
    const strong = hits(grants, ["get", "list"], "", "secrets", true).has(null) || POD_MAKERS.some(([group, resource]) => hits(grants, ["create"], group, resource, true).has(null)) || hits(grants, ["get"], "*", "*", true).has(null);
    if (!strong) continue;
    const groups = new Set<string>();
    for (const grant of grants) {
      if (grant.ns !== null) continue;
      if (!grant.verbs.some((verb) => ["get", "list", "watch", "update", "patch", "*"].includes(verb))) continue;
      for (const group of grant.groups) if (!CORE_GROUPS.has(group) && group !== "*") groups.add(group);
    }
    if (groups.size) out.set(key, [...groups].sort());
  }
  operatorCache.set(cluster, out);
  return out;
}

function edgesFor(cluster: Cluster, key: string, shallow: boolean, cache: Map<string, Hop[]>, visiting: Set<string>, grantsFor: (key: string) => Grant[]): Hop[] {
  const cacheKey = `${key}:${shallow ? "s" : "f"}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  if (visiting.has(cacheKey)) return [];
  visiting.add(cacheKey);
  let out: Hop[] = [];
  if (key !== GOAL && key === NODE_ROOT) {
    const seen = new Set<string>();
    for (const workload of cluster.workloads) {
      const target = saKey(workload.ns, workload.sa);
      if (seen.has(target)) continue;
      seen.add(target);
      out.push(hop(target, "NODE_TOKENS", `read the projected token of ${workload.ns}/${workload.sa}`, "Root on a node can read projected service account tokens of pods on that node. Likely, because the pod has to land on a node the attacker reached.", "node root", workload.file, "serviceaccount", 1, "likely"));
    }
  } else if (key.startsWith("WL:")) {
    const workload = cluster.workloads.find((item) => item.key === key);
    if (workload) {
      out.push(hop(saKey(workload.ns, workload.sa), "WL_SA", `use the service account token in ${workload.kind}/${workload.name}`, `Code in that pod can act as ${workload.ns}/${workload.sa}.`, workload.sa, workload.file, workload.sa));
      if (workload.escapes.length) {
        out.push(hop(NODE_ROOT, "WL_ESCAPE", `break out to the node (${workload.escapes.slice(0, 3).join("; ")})`, "That pod spec gives root on the node.", workload.escapes[0], workload.file, workload.escapes[0].split(" ")[0], 1, "certain"));
      }
    }
  } else if (key !== GOAL) {
    out = identityEdges(cluster, key, shallow, grantsFor(key), (next, nextShallow) => edgesFor(cluster, next, nextShallow, cache, visiting, grantsFor));
  }
  visiting.delete(cacheKey);
  cache.set(cacheKey, out);
  return out;
}

function shortest(cluster: Cluster, start: string): Hop[] | null {
  const grantsFor = grantsOf(cluster);
  const cache = new Map<string, Hop[]>();
  const visiting = new Set<string>();
  const edges = (key: string) => edgesFor(cluster, key, false, cache, visiting, grantsFor);
  const best = new Map<string, number>([[start, 0]]);
  const queue: { id: string; cost: number; hops: Hop[] }[] = [{ id: start, cost: 0, hops: [] }];
  let expanded = 0;
  while (queue.length && expanded < 4000) {
    queue.sort((a, b) => a.cost - b.cost);
    const current = queue.shift()!;
    if ((best.get(current.id) ?? Infinity) < current.cost) continue;
    if (current.id === GOAL) return current.hops;
    if (current.hops.length >= 8) continue;
    expanded += 1;
    for (const edge of edges(current.id)) {
      if (current.hops.some((item) => item.to === edge.to)) continue;
      const next = current.cost + edge.cost;
      if (next >= (best.get(edge.to) ?? Infinity)) continue;
      best.set(edge.to, next);
      queue.push({ id: edge.to, cost: next, hops: [...current.hops, edge] });
    }
  }
  return null;
}

const STEP_LABEL: Record<string, string> = {
  ADMIN: "Cluster admin",
  BIND: "Bind a role",
  ESCALATE: "Escalate a role",
  IMPERSONATE: "Impersonate",
  POD_CREATE: "Create a pod",
  EXEC: "Exec a pod",
  SECRETS_READ: "Read secrets",
  SECRET_MINT: "Mint a token",
  TOKEN_REQUEST: "Request a token",
  NODES_PROXY: "Kubelet proxy",
  WEBHOOK: "Mutating webhook",
  AWS_AUTH: "aws-auth",
  DEPUTY: "Confused operator",
  WL_ESCAPE: "Node escape",
  NODE_TOKENS: "Read node tokens",
};

function stepIcon(kind: string): NodeIcon {
  if (kind === "ADMIN") return "admin";
  if (kind === "WL_ESCAPE" || kind === "NODE_TOKENS") return "node";
  if (kind === "SECRETS_READ" || kind === "SECRET_MINT" || kind === "TOKEN_REQUEST") return "secret";
  return "rbac";
}

function pathImpact(hops: Hop[]): number {
  if (hops.some((item) => item.confidence === "heuristic")) return 74;
  if (hops.some((item) => item.confidence === "likely")) return 90;
  return 100;
}

function buildPath(hops: Hop[]): EscalationPath {
  const meaningful = hops.filter((item) => item.kind !== "WL_SA");
  const direct = meaningful.every((item) => item.kind === "ADMIN");
  const kinds = hops.map((item) => item.kind);
  const escapeAt = kinds.indexOf("WL_ESCAPE");
  const rbacAt = kinds.findIndex((kind) => !["WL_SA", "WL_ESCAPE", "NODE_TOKENS", "ADMIN"].includes(kind));
  const gate = escapeAt >= 0 && (rbacAt < 0 || escapeAt < rbacAt) ? "node" : "rbac";
  const structural = new Set(["ADMIN", "NODE_TOKENS", "WL_SA", "WL_ESCAPE"]);
  const cut = hops.find((item) => !structural.has(item.kind)) || hops.find((item) => item.kind !== "ADMIN") || hops[0];
  const sentences = meaningful.map((item, index) => `${index + 1}. ${item.text}. ${item.how}`);
  const located = meaningful.find((item) => item.file) || hops.find((item) => item.file);
  return {
    impact: pathImpact(hops),
    direct,
    gate,
    detail: sentences.join(" "),
    fix: FIX[cut?.kind || "ADMIN"] || FIX.ADMIN,
    fixKind: cut?.kind || "ADMIN",
    token: located?.token || cut?.token || "cluster-admin",
    file: located?.file,
    steps: [
      ...meaningful.slice(0, 4).map((item) => ({
        label: STEP_LABEL[item.kind] || item.kind,
        caption: item.text.length > 72 ? `${item.text.slice(0, 69)}...` : item.text,
        edge: item.confidence === "certain" ? item.kind.toLowerCase().replaceAll("_", " ") : item.confidence,
        icon: stepIcon(item.kind),
      })),
      ...(meaningful.length && meaningful[meaningful.length - 1].kind !== "ADMIN"
        ? [{ label: "Cluster admin", caption: "End of this path", edge: "reaches", icon: "admin" as const }]
        : []),
    ].slice(0, 5),
  };
}

function held(grants: Grant[], verbs: string[], group: string, resource: string): Hit | undefined {
  const found = hits(grants, verbs, group, resource, false);
  return found.get(null) || [...found.values()][0];
}

function exposuresFor(grants: Grant[], path?: EscalationPath): EscalationExposure[] {
  if (isAdminGrant(grants)) return [];
  const out: EscalationExposure[] = [];
  const add = (id: string, title: string, detail: string, impact: number, token: string, file?: string) => {
    out.push({ id, title, detail, impact, token, file });
  };
  const impersonate = held(grants, ["impersonate"], "", "users") || held(grants, ["impersonate"], "", "groups") || held(grants, ["impersonate"], "", "serviceaccounts");
  if (impersonate) add("rbac-impersonate", "Impersonate", "Can impersonate another user, group, or service account. That is not a finished path to cluster admin on its own.", 80, "impersonate", impersonate.file);
  const bind = held(grants, ["bind"], RBAC, "clusterroles") || held(grants, ["bind"], RBAC, "roles");
  if (bind) add("rbac-bind", "Bind a role", "Can bind a role. Without a matching create on bindings, or with the role pinned, this does not yet reach cluster admin.", 76, "bind", bind.file);
  const escalate = held(grants, ["escalate"], RBAC, "clusterroles") || held(grants, ["escalate"], RBAC, "roles");
  if (escalate) add("rbac-escalate", "Escalate a role", "Can escalate a role. The matching update or create is missing, so this is not yet cluster admin.", 76, "escalate", escalate.file);
  const token = held(grants, ["create"], "", "serviceaccounts/token");
  if (token) add("rbac-token", "Mint a service account token", "Can request a token for a service account.", 70, "serviceaccounts/token", token.file);
  const mint = held(grants, ["create"], "", "secrets");
  if (mint) add("rbac-mint", "Create token secrets", "Can create a secret that the controller fills with a service account token.", 64, "secrets", mint.file);
  const csr = held(grants, ["create"], "certificates.k8s.io", "certificatesigningrequests");
  const approval = held(grants, ["update", "patch"], "certificates.k8s.io", "certificatesigningrequests/approval");
  const signer = held(grants, ["approve"], "certificates.k8s.io", "signers");
  const signerOk = signer && (!signer.names || [...signer.names].some((name) => name === "*" || name === "kubernetes.io/*" || name === "kubernetes.io/kube-apiserver-client"));
  if (csr && approval && signerOk) {
    add("rbac-csr", "Approve client certificates", "Can create and approve client certificates. Kubernetes 1.22 and later rejects system:masters on this signer, so this is not cluster admin, but it can become another user.", 60, "certificatesigningrequests", csr.file);
  }
  const policy = held(grants, ["create", "update", "patch", "delete"], "admissionregistration.k8s.io", "validatingwebhookconfigurations");
  if (policy) add("rbac-policy", "Rewrite validating webhooks", "Can rewrite or delete validating webhooks, which removes guardrails that stop other hops.", 55, "validatingwebhookconfigurations", policy.file);
  const api = held(grants, ["create", "update", "patch"], "apiregistration.k8s.io", "apiservices");
  if (api) add("rbac-api", "Redirect an aggregated API", "Can point an aggregated API, such as metrics, at a server the attacker runs.", 55, "apiservices", api.file);
  if (path && path.impact >= 90) {
    return out.filter((item) => item.id === "rbac-csr" || item.id === "rbac-policy" || item.id === "rbac-api").slice(0, 2);
  }
  return out.slice(0, 4);
}

function standingNotes(cluster: Cluster, grantsFor: (key: string) => Grant[]): StandingNote[] {
  const notes: StandingNote[] = [];
  for (const role of cluster.roles.values()) {
    if (role.kind !== "ClusterRole") continue;
    const targets = ["admin", "edit", "view"].filter((name) => role.labels[`rbac.authorization.k8s.io/aggregate-to-${name}`] === "true");
    if (!targets.length) continue;
    const grants = grantsFor(`ROLE:ClusterRole/${role.name}@*`);
    const bad: string[] = [];
    if (hits(grants, ["get", "list"], "", "secrets").size) bad.push("read secrets");
    if (POD_MAKERS.some(([group, resource]) => hits(grants, ["create"], group, resource).size)) bad.push("create workloads");
    if (grants.some((grant) => grant.verbs.some((verb) => ["impersonate", "bind", "escalate"].includes(verb)))) bad.push("bind, escalate, or impersonate");
    if (!bad.length) continue;
    notes.push({
      title: `ClusterRole ${role.name}`,
      detail: `Aggregated into ${targets.join(", ")} and can ${bad.join(" and ")}. Every holder of that built-in role inherits it.`,
    });
    if (notes.length >= 3) break;
  }
  return notes;
}

function cutsOf(paths: { hops: Hop[] }[]): PathCut[] {
  const units = new Map<string, { kind: string; via: string; indexes: Set<number> }>();
  paths.forEach((path, index) => {
    const structural = new Set(["ADMIN", "NODE_TOKENS", "WL_SA", "WL_ESCAPE"]);
    const chosen = path.hops.filter((hop) => !structural.has(hop.kind));
    const list = chosen.length ? chosen : path.hops.filter((hop) => hop.kind !== "ADMIN");
    for (const hop of list) {
      const via = hop.via.split(" (inherited")[0];
      const key = `${hop.kind}|${via}`;
      const unit = units.get(key) || { kind: hop.kind, via, indexes: new Set<number>() };
      unit.indexes.add(index);
      units.set(key, unit);
    }
  });
  const left = new Set(paths.map((_, index) => index));
  const cuts: PathCut[] = [];
  while (left.size && cuts.length < 3) {
    let best: { kind: string; via: string; indexes: Set<number> } | undefined;
    for (const unit of units.values()) {
      const covered = [...unit.indexes].filter((index) => left.has(index)).length;
      const bestCovered = best ? [...best.indexes].filter((index) => left.has(index)).length : 0;
      if (!best || covered > bestCovered) best = unit;
    }
    if (!best) break;
    const covered = [...best.indexes].filter((index) => left.has(index));
    if (!covered.length) break;
    for (const index of covered) left.delete(index);
    cuts.push({ title: best.via, detail: FIX[best.kind] || FIX.ADMIN, paths: covered.length });
  }
  return cuts;
}

export function escalationReport(manifests: Manifest[]): EscalationReport {
  const cluster = loadCluster(manifests);
  const grantsFor = grantsOf(cluster);
  const byWorkload = new Map<string, WorkloadEscalation>();
  const found: { hops: Hop[] }[] = [];
  for (const workload of cluster.workloads) {
    const hops = shortest(cluster, workload.key);
    const path = hops && hops.length ? buildPath(hops) : undefined;
    const exposures = exposuresFor(grantsFor(saKey(workload.ns, workload.sa)), path);
    if (path && !path.direct) found.push({ hops: hops! });
    if ((path && !path.direct) || exposures.length) byWorkload.set(workload.id, { path, exposures });
  }
  const caveat = cluster.admission.size
    ? "This repository includes a policy engine. Fathom does not evaluate those policies, so a path here may be blocked in the cluster."
    : undefined;
  return { byWorkload, cuts: cutsOf(found), standing: standingNotes(cluster, grantsFor), caveat };
}
