import { repoScore, severity, unionScore } from "./score";
import type { Manifest } from "./parse";
import type {
  Finding,
  FindingCategory,
  Fix,
  FixOp,
  GraphEdge,
  GraphNode,
  NodeIcon,
  ScoreFactor,
  WorkloadView,
} from "./types";

interface Access {
  clusterAdmin: boolean;
  clusterSecrets: boolean;
  namespaceSecrets: boolean;
  podCreate: boolean;
  podExec: boolean;
  nodesProxy: boolean;
  proxyToken?: string;
  proxyFile?: string;
  bindingName?: string;
  bindingKind?: string;
  bindingFile?: string;
  roleNames: string[];
}

interface Service {
  namespace: string;
  name: string;
  selector: Record<string, string>;
  labels: Record<string, string>;
  file?: string;
}

interface Peer {
  podLabels: Record<string, string> | null;
  allPodsInNamespace: boolean;
  namespaces: "same" | "all";
}

interface Policy {
  namespace: string;
  podSelector: Record<string, string> | null;
  selectsAll: boolean;
  isolatesEgress: boolean;
  peers: Peer[];
  allowAll: boolean;
}

interface SecretInfo {
  namespace: string;
  name: string;
  keys: number;
  committed: boolean;
  file?: string;
}

interface Workload {
  id: string;
  kind: string;
  name: string;
  namespace: string;
  serviceAccount: string;
  labels: Record<string, string>;
  annotations: Record<string, string>;
  sourceFile?: string;
  image: string;
  privileged: boolean;
  allowPrivilegeEscalation: boolean;
  hostNetwork: boolean;
  hostPID: boolean;
  hostIPC: boolean;
  hostPort: boolean;
  capabilities: string[];
  hostPaths: string[];
  mountedSecrets: string[];
  saFile?: string;
}

interface Asset {
  id: string;
  title: string;
  caption: string;
  detail: string;
  impact: number;
  category: FindingCategory;
  edge: string;
  token: string;
  file?: string;
  sourceKind?: string;
  sourceName?: string;
  fixOp: FixOp;
}

interface Model {
  workloads: Workload[];
  access: Map<string, Access>;
  services: Service[];
  policies: Policy[];
  secrets: Map<string, SecretInfo>;
}

const FIX_COPY: Record<FixOp, { title: string; detail: string }> = {
  "clear-node": {
    title: "Remove node escape",
    detail: "Drop hostPath mounts, privileged mode, and host namespaces together.",
  },
  "clear-hostpath": {
    title: "Remove hostPath mounts",
    detail: "Delete hostPath volumes so the container cannot see the node filesystem.",
  },
  "clear-privilege": {
    title: "Drop privileged execution",
    detail: "Set privileged and allowPrivilegeEscalation to false and drop added capabilities.",
  },
  "clear-hostns": {
    title: "Leave the host namespaces",
    detail: "Set hostNetwork, hostPID, and hostIPC to false and remove hostPort.",
  },
  "drop-rbac": {
    title: "Remove cluster-wide RBAC",
    detail: "Replace the cluster binding with a namespace Role that can only read configmaps.",
  },
  "isolate-egress": {
    title: "Default-deny egress",
    detail: "Select this pod with an egress NetworkPolicy that allows no destinations.",
  },
  "unmount-secrets": {
    title: "Unmount secrets",
    detail: "Remove secret volumes and env refs from this workload.",
  },
  "scope-cloud": {
    title: "Scope the cloud role",
    detail: "Replace the attached cloud role with a read-only role.",
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function labelsOf(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const match = isRecord(value.matchLabels) ? value.matchLabels : value;
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(match)) {
    if (typeof entry === "string") out[key] = entry;
  }
  return out;
}

function has(verbs: string[], resources: string[], verb: string, resource: string): boolean {
  const verbOk = verbs.includes("*") || verbs.includes(verb);
  const resourceOk = resources.includes("*") || resources.includes(resource);
  return verbOk && resourceOk;
}

function blankAccess(): Access {
  return {
    clusterAdmin: false,
    clusterSecrets: false,
    namespaceSecrets: false,
    podCreate: false,
    podExec: false,
    nodesProxy: false,
    roleNames: [],
  };
}

function podTemplate(manifest: Manifest): { spec: Record<string, unknown>; labels: Record<string, string>; annotations: Record<string, string> } | null {
  if (manifest.kind === "Pod") {
    return { spec: manifest.spec, labels: manifest.metadata.labels, annotations: manifest.metadata.annotations };
  }
  const spec = manifest.spec;
  const template =
    manifest.kind === "CronJob"
      ? (isRecord(spec.jobTemplate) && isRecord(spec.jobTemplate.spec) && isRecord(spec.jobTemplate.spec.template)
          ? spec.jobTemplate.spec.template
          : null)
      : isRecord(spec.template)
        ? spec.template
        : null;
  if (!isRecord(template) || !isRecord(template.spec)) return null;
  const meta = isRecord(template.metadata) ? template.metadata : {};
  return {
    spec: template.spec,
    labels: labelsOf(isRecord(meta.labels) ? { matchLabels: meta.labels } : {}),
    annotations: labelsOf(isRecord(meta.annotations) ? { matchLabels: meta.annotations } : {}),
  };
}

function workloadKinds(kind: string): boolean {
  return ["Pod", "Deployment", "StatefulSet", "DaemonSet", "Job", "CronJob", "ReplicaSet"].includes(kind);
}

function extractWorkload(manifest: Manifest): Workload | null {
  if (!workloadKinds(manifest.kind)) return null;
  const template = podTemplate(manifest);
  if (!template) return null;
  const spec = template.spec;
  const containers = [
    ...asArray(spec.containers),
    ...asArray(spec.initContainers),
    ...asArray(spec.ephemeralContainers),
  ].filter(isRecord);
  const podSec = isRecord(spec.securityContext) ? spec.securityContext : {};
  let privileged = false;
  let allowPrivilegeEscalation = false;
  let hostPort = false;
  const capabilities: string[] = [];
  let image = "";
  for (const container of containers) {
    if (!image && typeof container.image === "string") image = container.image;
    const sec = isRecord(container.securityContext) ? container.securityContext : {};
    if (sec.privileged === true || podSec.privileged === true) privileged = true;
    if (sec.allowPrivilegeEscalation === true) allowPrivilegeEscalation = true;
    const caps = isRecord(sec.capabilities) ? asArray(sec.capabilities.add) : [];
    for (const cap of caps) {
      if (typeof cap === "string") capabilities.push(cap.replace(/^CAP_/, "").toUpperCase());
    }
    for (const port of asArray(container.ports).filter(isRecord)) {
      if (typeof port.hostPort === "number") hostPort = true;
    }
  }
  const hostPaths: string[] = [];
  const mountedSecrets: string[] = [];
  for (const volume of asArray(spec.volumes).filter(isRecord)) {
    if (isRecord(volume.hostPath) && typeof volume.hostPath.path === "string") hostPaths.push(volume.hostPath.path);
    if (isRecord(volume.secret) && typeof volume.secret.secretName === "string") mountedSecrets.push(volume.secret.secretName);
    if (isRecord(volume.projected)) {
      for (const source of asArray(volume.projected.sources).filter(isRecord)) {
        if (isRecord(source.secret) && typeof source.secret.name === "string") mountedSecrets.push(source.secret.name);
      }
    }
  }
  for (const container of containers) {
    for (const env of asArray(container.env).filter(isRecord)) {
      const from = isRecord(env.valueFrom) ? env.valueFrom : {};
      if (isRecord(from.secretKeyRef) && typeof from.secretKeyRef.name === "string") mountedSecrets.push(from.secretKeyRef.name);
    }
    for (const envFrom of asArray(container.envFrom).filter(isRecord)) {
      if (isRecord(envFrom.secretRef) && typeof envFrom.secretRef.name === "string") mountedSecrets.push(envFrom.secretRef.name);
    }
  }
  const sa =
    (typeof spec.serviceAccountName === "string" && spec.serviceAccountName) ||
    (typeof spec.serviceAccount === "string" && spec.serviceAccount) ||
    "default";
  return {
    id: `${manifest.metadata.namespace}/${manifest.kind}/${manifest.metadata.name}`,
    kind: manifest.kind,
    name: manifest.metadata.name,
    namespace: manifest.metadata.namespace,
    serviceAccount: sa,
    labels: template.labels,
    annotations: { ...template.annotations },
    sourceFile: manifest.sourceFile,
    image,
    privileged,
    allowPrivilegeEscalation,
    hostNetwork: spec.hostNetwork === true,
    hostPID: spec.hostPID === true,
    hostIPC: spec.hostIPC === true,
    hostPort,
    capabilities,
    hostPaths,
    mountedSecrets: [...new Set(mountedSecrets)],
  };
}

function parseRules(manifest: Manifest): { verbs: string[]; resources: string[] }[] {
  return asArray(manifest.spec.rules)
    .filter(isRecord)
    .map((rule) => ({
      verbs: asArray(rule.verbs).filter((verb): verb is string => typeof verb === "string"),
      resources: asArray(rule.resources).filter((resource): resource is string => typeof resource === "string"),
    }));
}

function subjectsOf(manifest: Manifest): { kind: string; name: string; namespace?: string }[] {
  return asArray(manifest.spec.subjects)
    .filter(isRecord)
    .map((subject) => ({
      kind: typeof subject.kind === "string" ? subject.kind : "",
      name: typeof subject.name === "string" ? subject.name : "",
      namespace: typeof subject.namespace === "string" ? subject.namespace : undefined,
    }));
}

function buildModel(manifests: Manifest[]): Model {
  const roles = new Map<string, { cluster: boolean; rules: { verbs: string[]; resources: string[] }[]; file?: string }>();
  const bindings: Manifest[] = [];
  const services: Service[] = [];
  const policies: Policy[] = [];
  const secrets = new Map<string, SecretInfo>();
  const serviceAccounts = new Map<string, { annotations: Record<string, string>; file?: string }>();
  const workloads: Workload[] = [];

  for (const manifest of manifests) {
    if (manifest.kind === "Role" || manifest.kind === "ClusterRole") {
      const key = manifest.kind === "ClusterRole" ? `cluster/${manifest.metadata.name}` : `${manifest.metadata.namespace}/${manifest.metadata.name}`;
      roles.set(key, { cluster: manifest.kind === "ClusterRole", rules: parseRules(manifest), file: manifest.sourceFile });
    } else if (manifest.kind === "RoleBinding" || manifest.kind === "ClusterRoleBinding") {
      bindings.push(manifest);
    } else if (manifest.kind === "Service") {
      const selector = labelsOf(isRecord(manifest.spec.selector) ? { matchLabels: manifest.spec.selector } : {});
      services.push({
        namespace: manifest.metadata.namespace,
        name: manifest.metadata.name,
        selector,
        labels: manifest.metadata.labels,
        file: manifest.sourceFile,
      });
    } else if (manifest.kind === "NetworkPolicy") {
      policies.push(parsePolicy(manifest));
    } else if (manifest.kind === "Secret") {
      secrets.set(`${manifest.metadata.namespace}/${manifest.metadata.name}`, {
        namespace: manifest.metadata.namespace,
        name: manifest.metadata.name,
        keys: manifest.keyCount,
        committed: manifest.committed,
        file: manifest.sourceFile,
      });
    } else if (manifest.kind === "ServiceAccount") {
      serviceAccounts.set(`${manifest.metadata.namespace}/${manifest.metadata.name}`, {
        annotations: manifest.metadata.annotations,
        file: manifest.sourceFile,
      });
    } else {
      const workload = extractWorkload(manifest);
      if (workload) workloads.push(workload);
    }
  }

  for (const workload of workloads) {
    const sa = serviceAccounts.get(`${workload.namespace}/${workload.serviceAccount}`);
    if (sa) {
      workload.annotations = { ...sa.annotations, ...workload.annotations };
      workload.saFile = sa.file;
    }
  }

  const access = new Map<string, Access>();
  const ensure = (key: string) => {
    let current = access.get(key);
    if (!current) {
      current = blankAccess();
      access.set(key, current);
    }
    return current;
  };

  for (const binding of bindings) {
    const roleRef = isRecord(binding.spec.roleRef) ? binding.spec.roleRef : {};
    const roleName = typeof roleRef.name === "string" ? roleRef.name : "";
    const roleKind = typeof roleRef.kind === "string" ? roleRef.kind : "Role";
    const role = roles.get(roleKind === "ClusterRole" ? `cluster/${roleName}` : `${binding.metadata.namespace}/${roleName}`);
    const clusterScoped = binding.kind === "ClusterRoleBinding";
    for (const subject of subjectsOf(binding)) {
      if (subject.kind !== "ServiceAccount" || !subject.name) continue;
      const ns = subject.namespace || binding.metadata.namespace;
      const entry = ensure(`${ns}/${subject.name}`);
      entry.roleNames.push(roleName);
      entry.bindingName = binding.metadata.name;
      entry.bindingKind = binding.kind;
      entry.bindingFile = binding.sourceFile;
      if (clusterScoped && roleName === "cluster-admin") entry.clusterAdmin = true;
      const rules = role?.rules || [];
      for (const rule of rules) {
        const cluster = clusterScoped;
        if (cluster && (has(rule.verbs, rule.resources, "*", "*") || (rule.verbs.includes("*") && rule.resources.includes("*")))) {
          entry.clusterAdmin = true;
        }
        const secretVerbs = ["get", "list", "watch"].some((verb) => has(rule.verbs, rule.resources, verb, "secrets"));
        if (secretVerbs && cluster) entry.clusterSecrets = true;
        if (secretVerbs && !cluster) entry.namespaceSecrets = true;
        if (has(rule.verbs, rule.resources, "create", "pods")) {
          if (cluster) entry.podCreate = true;
        }
        if (has(rule.verbs, rule.resources, "create", "pods/exec")) entry.podExec = true;
        const proxyVerbs = ["get", "list", "watch", "create", "*"].some((verb) => has(rule.verbs, rule.resources, verb, "nodes/proxy"));
        if (proxyVerbs) {
          entry.nodesProxy = true;
          if (role?.file) entry.proxyFile = role.file;
          if (!entry.proxyToken || rule.resources.includes("nodes/proxy")) {
            entry.proxyToken = rule.resources.includes("nodes/proxy") ? "nodes/proxy" : '["*"]';
          }
        }
      }
    }
  }

  return { workloads, access, services, policies, secrets };
}

function parsePolicy(manifest: Manifest): Policy {
  const spec = manifest.spec;
  const podSelector = isRecord(spec.podSelector) ? spec.podSelector : {};
  const matchLabels = isRecord(podSelector.matchLabels) ? labelsOf({ matchLabels: podSelector.matchLabels }) : {};
  const selectsAll = Object.keys(podSelector).length === 0 || Object.keys(matchLabels).length === 0 && !isRecord(podSelector.matchExpressions);
  const types = asArray(spec.policyTypes).filter((entry): entry is string => typeof entry === "string");
  const isolatesEgress = types.includes("Egress") || "egress" in spec;
  const egress = asArray(spec.egress).filter(isRecord);
  const peers: Peer[] = [];
  let allowAll = false;
  for (const rule of egress) {
    const to = asArray(rule.to).filter(isRecord);
    if (to.length === 0) allowAll = true;
    for (const peer of to) {
      if (isRecord(peer.ipBlock)) continue;
      const podSel = isRecord(peer.podSelector) ? peer.podSelector : null;
      const nsSel = isRecord(peer.namespaceSelector) ? peer.namespaceSelector : null;
      const podLabels = podSel && isRecord(podSel.matchLabels) ? labelsOf({ matchLabels: podSel.matchLabels }) : null;
      const allPods = !!podSel && Object.keys(podSel).length === 0;
      peers.push({
        podLabels: allPods ? {} : podLabels,
        allPodsInNamespace: allPods,
        namespaces: nsSel ? "all" : "same",
      });
    }
  }
  return {
    namespace: manifest.metadata.namespace,
    podSelector: selectsAll ? null : matchLabels,
    selectsAll,
    isolatesEgress,
    peers,
    allowAll,
  };
}

function selects(policy: Policy, labels: Record<string, string>): boolean {
  if (!policy.isolatesEgress) return false;
  if (policy.selectsAll || !policy.podSelector) return true;
  return Object.entries(policy.podSelector).every(([key, value]) => labels[key] === value);
}

function sensitive(name: string): boolean {
  return /vault|pci|postgres|mysql|redis|mongo|stripe|database/.test(name.toLowerCase());
}

function selectorMatches(selector: Record<string, string>, peerLabels: Record<string, string> | null, allPods: boolean): boolean {
  if (allPods || !peerLabels) return true;
  if (Object.keys(peerLabels).length === 0) return true;
  return Object.entries(peerLabels).every(([key, value]) => selector[key] === value);
}

interface Egress {
  mode: "open" | "deny" | "allow";
  services: { service: Service; intended: boolean }[];
}

function egressFor(workload: Workload, model: Model, forceDeny: boolean): Egress {
  if (forceDeny) return { mode: "deny", services: [] };
  const applicable = model.policies.filter((policy) => policy.namespace === workload.namespace && selects(policy, workload.labels));
  if (applicable.length === 0) {
    return {
      mode: "open",
      services: model.services
        .filter((service) => !(service.namespace === workload.namespace && service.name === workload.name))
        .filter((service) => Object.keys(service.selector).length > 0)
        .map((service) => ({ service, intended: false })),
    };
  }
  if (applicable.some((policy) => policy.allowAll)) {
    return {
      mode: "open",
      services: model.services
        .filter((service) => Object.keys(service.selector).length > 0)
        .map((service) => ({ service, intended: false })),
    };
  }
  const matched: { service: Service; intended: boolean }[] = [];
  for (const policy of applicable) {
    for (const peer of policy.peers) {
      for (const service of model.services) {
        if (Object.keys(service.selector).length === 0) continue;
        const nsOk = peer.namespaces === "all" || service.namespace === workload.namespace;
        if (!nsOk) continue;
        if (!selectorMatches(service.selector, peer.podLabels, peer.allPodsInNamespace)) continue;
        if (!matched.some((item) => item.service === service)) matched.push({ service, intended: true });
      }
    }
  }
  if (matched.length === 0) return { mode: "deny", services: [] };
  return { mode: "allow", services: matched };
}

function classifyCloud(role: string): { impact: number; caption: string } | null {
  const value = role.toLowerCase();
  if (/admin|poweruser|owner|administrator/.test(value)) return { impact: 74, caption: "broad cloud role" };
  if (/secret|kms|vault/.test(value)) return { impact: 62, caption: "cloud secrets access" };
  if (/read|view/.test(value)) return { impact: 36, caption: "cloud read role" };
  return { impact: 46, caption: "workload identity" };
}

function cloudRole(annotations: Record<string, string>): { provider: string; role: string } | null {
  const aws = annotations["eks.amazonaws.com/role-arn"];
  if (aws) return { provider: "AWS IRSA", role: aws };
  const gcp = annotations["iam.gke.io/gcp-service-account"];
  if (gcp) return { provider: "GKE workload identity", role: gcp };
  const azure = annotations["azure.workload.identity/client-id"];
  if (azure) return { provider: "Azure workload identity", role: azure };
  return null;
}

function hostPathImpact(hostPath: string): { impact: number; reason: string } {
  const path = hostPath.replace(/\/+$/, "") || "/";
  if (
    path === "/" ||
    path === "/etc" ||
    path === "/proc" ||
    path === "/sys" ||
    path === "/root" ||
    path.includes("docker.sock") ||
    path.includes("containerd.sock") ||
    path.startsWith("/var/lib/kubelet") ||
    path.startsWith("/var/run/crio")
  ) {
    return { impact: 90, reason: `hostPath ${hostPath}` };
  }
  return { impact: 44, reason: `hostPath ${hostPath}` };
}

function secretImpact(name: string, committed: boolean): number {
  const base = /pass|token|key|cred|secret|tls|stripe|db|vault|unseal/.test(name.toLowerCase()) ? 48 : 32;
  return committed ? Math.max(base, 64) : base;
}

function assetsFor(workload: Workload, model: Model, opts?: { clearNode?: boolean; clearHostPath?: boolean; clearPrivilege?: boolean; clearHostNs?: boolean; dropRbac?: boolean; isolate?: boolean; unmount?: boolean; scopeCloud?: boolean }): Asset[] {
  const wl: Workload = { ...workload, hostPaths: [...workload.hostPaths], capabilities: [...workload.capabilities], mountedSecrets: [...workload.mountedSecrets] };
  if (opts?.clearNode || opts?.clearHostPath) wl.hostPaths = [];
  if (opts?.clearNode || opts?.clearPrivilege) {
    wl.privileged = false;
    wl.allowPrivilegeEscalation = false;
    wl.capabilities = [];
  }
  if (opts?.clearNode || opts?.clearHostNs) {
    wl.hostNetwork = false;
    wl.hostPID = false;
    wl.hostIPC = false;
    wl.hostPort = false;
  }
  if (opts?.unmount) wl.mountedSecrets = [];
  const access = opts?.dropRbac ? blankAccess() : model.access.get(`${wl.namespace}/${wl.serviceAccount}`) || blankAccess();
  const egress = egressFor(wl, model, !!opts?.isolate);
  const assets: Asset[] = [];

  const reasons: string[] = [];
  let nodeImpact = 0;
  for (const hostPath of wl.hostPaths) {
    const classified = hostPathImpact(hostPath);
    nodeImpact = Math.max(nodeImpact, classified.impact);
    reasons.push(classified.reason);
  }
  if (wl.privileged && (wl.hostPID || wl.hostNetwork || wl.hostIPC)) {
    nodeImpact = Math.max(nodeImpact, 78);
    reasons.push("privileged + host namespace");
  } else if (wl.privileged) {
    nodeImpact = Math.max(nodeImpact, 58);
    reasons.push("privileged");
  }
  if (wl.capabilities.includes("SYS_ADMIN")) {
    nodeImpact = Math.max(nodeImpact, 72);
    reasons.push("CAP_SYS_ADMIN");
  }
  if (wl.hostPort) {
    nodeImpact = Math.max(nodeImpact, 28);
    reasons.push("hostPort");
  } else if (wl.hostNetwork && nodeImpact < 34) {
    nodeImpact = Math.max(nodeImpact, 34);
    reasons.push("hostNetwork");
  }
  if (nodeImpact > 0) {
    const token = wl.hostPaths[0] || (wl.privileged ? "privileged: true" : wl.hostNetwork ? "hostNetwork" : wl.hostPID ? "hostPID" : wl.hostIPC ? "hostIPC" : "hostPort");
    assets.push({
      id: "node",
      title: nodeImpact >= 78 ? "Node compromise" : "Host access",
      caption: reasons[0] || "host",
      detail: `A compromise of ${wl.name} reaches the node via ${reasons.join(", ")}.`,
      impact: nodeImpact,
      category: "escape",
      edge: reasons[0]?.includes("hostPath") ? "hostPath" : wl.privileged ? "privileged" : "host namespace",
      token,
      file: wl.sourceFile,
      sourceKind: wl.kind,
      sourceName: wl.name,
      fixOp: wl.hostPaths.length && (wl.privileged || wl.hostPID || wl.hostNetwork) ? "clear-node" : wl.hostPaths.length ? "clear-hostpath" : wl.privileged ? "clear-privilege" : "clear-hostns",
    });
  }

  if (access.clusterAdmin) {
    assets.push({
      id: "rbac-admin",
      title: "cluster-admin",
      caption: access.bindingName || "ClusterRoleBinding",
      detail: `Service account ${wl.serviceAccount} is bound to cluster-admin${access.bindingName ? ` by ${access.bindingName}` : ""}. That is full control of the cluster.`,
      impact: 100,
      category: "rbac",
      edge: "RBAC",
      token: "cluster-admin",
      file: access.bindingFile,
      sourceKind: access.bindingKind,
      sourceName: access.bindingName,
      fixOp: "drop-rbac",
    });
  } else {
    if (access.podExec) {
      assets.push({
        id: "rbac-exec",
        title: "Pod exec",
        caption: "pods/exec",
        detail: `Service account ${wl.serviceAccount} can exec into pods.`,
        impact: 88,
        category: "rbac",
        edge: "RBAC",
        token: "pods/exec",
        file: access.bindingFile,
        sourceKind: access.bindingKind,
        sourceName: access.bindingName,
        fixOp: "drop-rbac",
      });
    }
    if (access.clusterSecrets) {
      assets.push({
        id: "rbac-secrets",
        title: "All cluster secrets",
        caption: "get/list secrets",
        detail: `Service account ${wl.serviceAccount} can read secrets in every namespace.`,
        impact: 84,
        category: "rbac",
        edge: "RBAC",
        token: "secrets",
        file: access.bindingFile,
        sourceKind: access.bindingKind,
        sourceName: access.bindingName,
        fixOp: "drop-rbac",
      });
    } else if (access.namespaceSecrets) {
      assets.push({
        id: "rbac-secrets-ns",
        title: "Namespace secrets",
        caption: wl.namespace,
        detail: `Service account ${wl.serviceAccount} can read secrets in ${wl.namespace}.`,
        impact: 52,
        category: "rbac",
        edge: "RBAC",
        token: "secrets",
        file: access.bindingFile,
        sourceKind: access.bindingKind,
        sourceName: access.bindingName,
        fixOp: "drop-rbac",
      });
    }
    if (access.podCreate) {
      assets.push({
        id: "rbac-pods",
        title: "Create pods",
        caption: "cluster scope",
        detail: `Service account ${wl.serviceAccount} can create pods in the cluster, which is a path to mounting other secrets.`,
        impact: access.clusterSecrets ? 70 : 62,
        category: "rbac",
        edge: "RBAC",
        token: "pods",
        file: access.bindingFile,
        sourceKind: access.bindingKind,
        sourceName: access.bindingName,
        fixOp: "drop-rbac",
      });
    }
    if (access.nodesProxy) {
      assets.push({
        id: "rbac-proxy",
        title: "Kubelet proxy",
        caption: "nodes/proxy",
        detail: `Service account ${wl.serviceAccount} can proxy the kubelet API through nodes/proxy.`,
        impact: 82,
        category: "rbac",
        edge: "RBAC",
        token: access.proxyToken || "nodes/proxy",
        file: access.proxyFile || access.bindingFile,
        sourceKind: access.bindingKind,
        sourceName: access.bindingName,
        fixOp: "drop-rbac",
      });
    }
  }

  for (const name of wl.mountedSecrets) {
    const info = model.secrets.get(`${wl.namespace}/${name}`);
    const impact = secretImpact(name, !!info?.committed);
    assets.push({
      id: `secret:${wl.namespace}/${name}`,
      title: name,
      caption: info?.committed ? "mounted · in git" : "mounted secret",
      detail: info?.committed
        ? `Secret ${name} is mounted and its ${info.keys} key${info.keys === 1 ? "" : "s"} are committed in git.`
        : `Secret ${name} is mounted into the workload.`,
      impact,
      category: "secret",
      edge: info?.committed ? "committed" : "mount",
      token: name,
      file: info?.file || wl.sourceFile,
      sourceKind: info ? "Secret" : wl.kind,
      sourceName: info ? name : wl.name,
      fixOp: "unmount-secrets",
    });
  }

  const cloud = cloudRole(wl.annotations);
  if (cloud && !opts?.scopeCloud) {
    const classified = classifyCloud(cloud.role);
    if (classified) {
      assets.push({
        id: "cloud",
        title: cloud.role.split("/").pop() || cloud.role,
        caption: classified.caption,
        detail: `${cloud.provider} attaches ${cloud.role}. Classified as ${classified.caption} from the role name.`,
        impact: classified.impact,
        category: "cloud",
        edge: cloud.provider === "AWS IRSA" ? "IRSA" : "workload identity",
        token: cloud.role,
        file: wl.saFile || wl.sourceFile,
        sourceKind: "ServiceAccount",
        sourceName: wl.serviceAccount,
        fixOp: "scope-cloud",
      });
    }
  } else if (cloud && opts?.scopeCloud) {
    assets.push({
      id: "cloud",
      title: "scoped read role",
      caption: "cloud read role",
      detail: "Cloud role narrowed to read-only.",
      impact: 36,
      category: "cloud",
      edge: "IRSA",
      token: cloud.role,
      file: wl.saFile || wl.sourceFile,
      sourceKind: "ServiceAccount",
      sourceName: wl.serviceAccount,
      fixOp: "scope-cloud",
    });
  }

  const notable: { service: Service; impact: number; intended: boolean }[] = [];
  const others: Service[] = [];
  for (const item of egress.services) {
    if (item.service.namespace === wl.namespace && item.service.name === wl.name) continue;
    const cross = item.service.namespace !== wl.namespace;
    const hot = sensitive(item.service.name);
    if (egress.mode === "allow") {
      if (hot) notable.push({ service: item.service, impact: 22, intended: true });
      continue;
    }
    if (hot && cross) notable.push({ service: item.service, impact: 62, intended: false });
    else if (hot) notable.push({ service: item.service, impact: 50, intended: false });
    else if (cross) notable.push({ service: item.service, impact: 40, intended: false });
    else others.push(item.service);
  }
  for (const item of notable) {
    assets.push({
      id: `svc:${item.service.namespace}/${item.service.name}`,
      title: item.service.name,
      caption: item.service.namespace,
      detail:
        egress.mode === "open"
          ? `No egress policy selects ${wl.name}, so it can connect to ${item.service.name} in ${item.service.namespace}.`
          : `Egress policy allows ${wl.name} to reach ${item.service.name} in ${item.service.namespace}.`,
      impact: item.impact,
      category: "network",
      edge: egress.mode === "open" ? "no egress policy" : "egress allowed",
      token: `name: ${wl.name}`,
      file: wl.sourceFile,
      sourceKind: wl.kind,
      sourceName: wl.name,
      fixOp: "isolate-egress",
    });
  }
  if (others.length > 0 && egress.mode === "open") {
    assets.push({
      id: "svc-other",
      title: others.length === 1 ? others[0].name : `${others.length} other services`,
      caption: "same namespace",
      detail: `No egress policy selects ${wl.name}, so it can also reach ${others.map((service) => service.name).join(", ")}.`,
      impact: 24,
      category: "network",
      edge: "no egress policy",
      token: `name: ${wl.name}`,
      file: wl.sourceFile,
      sourceKind: wl.kind,
      sourceName: wl.name,
      fixOp: "isolate-egress",
    });
  }

  const byId = new Map<string, Asset>();
  for (const asset of assets) {
    const existing = byId.get(asset.id);
    if (!existing || asset.impact > existing.impact) byId.set(asset.id, asset);
  }
  return [...byId.values()].sort((a, b) => b.impact - a.impact || a.title.localeCompare(b.title));
}

function scoreOf(assets: Asset[]): number {
  return unionScore(assets.map((asset) => asset.impact));
}

function factorsOf(assets: Asset[]): ScoreFactor[] {
  return assets.map((asset) => ({ id: asset.id, label: asset.title, points: asset.impact }));
}

function iconFor(asset: Asset): NodeIcon {
  if (asset.id === "rbac-admin") return "admin";
  if (asset.id === "node") return "node";
  if (asset.id.startsWith("secret:")) return "secret";
  if (asset.id === "cloud") return "cloud";
  if (asset.id.startsWith("svc")) return "network";
  return "rbac";
}

function summary(workload: Workload, assets: Asset[]): string {
  if (assets.length === 0) return "No meaningful reach beyond this workload.";
  const labels = assets.slice(0, 3).map((asset) => asset.title);
  if (assets.length > 3) labels.push(`${assets.length - 3} more`);
  if (labels.length === 1) return `Compromise reaches ${labels[0]}.`;
  const last = labels.pop();
  return `Compromise reaches ${labels.join(", ")} and ${last}.`;
}

function patchFor(workload: Workload, op: FixOp, file: string): string {
  const target = file || workload.sourceFile || `${workload.kind.toLowerCase()}.yaml`;
  const header = `--- a/${target}\n+++ b/${target}\n@@ ${workload.kind} ${workload.namespace}/${workload.name}\n`;
  if (op === "clear-node" || op === "clear-hostpath" || op === "clear-privilege" || op === "clear-hostns") {
    const lines = [header.trimEnd()];
    if ((op === "clear-node" || op === "clear-hostns") && workload.hostNetwork) lines.push("- hostNetwork: true", "+ hostNetwork: false");
    if ((op === "clear-node" || op === "clear-hostns") && workload.hostPID) lines.push("- hostPID: true", "+ hostPID: false");
    if ((op === "clear-node" || op === "clear-hostns") && workload.hostIPC) lines.push("- hostIPC: true", "+ hostIPC: false");
    if ((op === "clear-node" || op === "clear-hostns") && workload.hostPort) lines.push("- hostPort: 80", "+ # hostPort removed");
    if ((op === "clear-node" || op === "clear-privilege") && workload.privileged) {
      lines.push("- privileged: true", "+ privileged: false", "+ allowPrivilegeEscalation: false", "+ runAsNonRoot: true");
    }
    if ((op === "clear-node" || op === "clear-privilege") && workload.capabilities.length) {
      lines.push(`- capabilities.add: [${workload.capabilities.join(", ")}]`, '+ capabilities.drop: ["ALL"]');
    }
    if (op === "clear-node" || op === "clear-hostpath") {
      for (const hostPath of workload.hostPaths) lines.push(`- hostPath.path: ${hostPath}`, "+ # hostPath removed");
    }
    return `${lines.join("\n")}\n`;
  }
  if (op === "drop-rbac") {
    return `${header}- kind: ClusterRoleBinding\n- roleRef:\n-   name: cluster-admin\n+ kind: Role\n+ metadata:\n+   name: ${workload.serviceAccount}\n+   namespace: ${workload.namespace}\n+ rules:\n+   - apiGroups: [""]\n+     resources: ["configmaps"]\n+     verbs: ["get", "list"]\n`;
  }
  if (op === "isolate-egress") {
    return `${header}+ apiVersion: networking.k8s.io/v1\n+ kind: NetworkPolicy\n+ metadata:\n+   name: ${workload.name}-deny-egress\n+   namespace: ${workload.namespace}\n+ spec:\n+   podSelector:\n+     matchLabels:\n+       app: ${workload.labels.app || workload.name}\n+   policyTypes: ["Egress"]\n+   egress: []\n`;
  }
  if (op === "unmount-secrets") {
    const lines = [header.trimEnd()];
    for (const name of workload.mountedSecrets) lines.push(`- secret: ${name}`, "+ # secret unmounted");
    return `${lines.join("\n")}\n`;
  }
  const cloud = cloudRole(workload.annotations);
  const current = cloud?.role || "ROLE";
  const scoped = current.replace(/administrator|admin|poweruser|owner/gi, "read");
  return `${header}- eks.amazonaws.com/role-arn: ${current}\n+ eks.amazonaws.com/role-arn: ${scoped === current ? `${current}-read` : scoped}\n`;
}

function candidateOps(workload: Workload, model: Model): FixOp[] {
  const ops: FixOp[] = [];
  const nodeSignals = [workload.hostPaths.length > 0, workload.privileged || workload.capabilities.length > 0, workload.hostNetwork || workload.hostPID || workload.hostIPC || workload.hostPort].filter(Boolean).length;
  if (nodeSignals >= 2) ops.push("clear-node");
  if (workload.hostPaths.length) ops.push("clear-hostpath");
  if (workload.privileged || workload.capabilities.length || workload.allowPrivilegeEscalation) ops.push("clear-privilege");
  if (workload.hostNetwork || workload.hostPID || workload.hostIPC || workload.hostPort) ops.push("clear-hostns");
  const access = model.access.get(`${workload.namespace}/${workload.serviceAccount}`);
  if (access && (access.clusterAdmin || access.clusterSecrets || access.namespaceSecrets || access.podCreate || access.podExec || access.nodesProxy)) ops.push("drop-rbac");
  const egress = egressFor(workload, model, false);
  if (egress.mode !== "deny" && egress.services.length > 0) ops.push("isolate-egress");
  if (workload.mountedSecrets.length) ops.push("unmount-secrets");
  const cloud = cloudRole(workload.annotations);
  if (cloud && classifyCloud(cloud.role)!.impact > 36) ops.push("scope-cloud");
  return ops;
}

function applyOp(op: FixOp) {
  return {
    clearNode: op === "clear-node",
    clearHostPath: op === "clear-hostpath",
    clearPrivilege: op === "clear-privilege",
    clearHostNs: op === "clear-hostns",
    dropRbac: op === "drop-rbac",
    isolate: op === "isolate-egress",
    unmount: op === "unmount-secrets",
    scopeCloud: op === "scope-cloud",
  };
}

function toView(workload: Workload, model: Model): WorkloadView {
  const assets = assetsFor(workload, model);
  const before = scoreOf(assets);
  const fixes: Fix[] = [];
  for (const op of candidateOps(workload, model)) {
    const afterAssets = assetsFor(workload, model, applyOp(op));
    const after = scoreOf(afterAssets);
    const shrink = before - after;
    if (shrink < 5) continue;
    const removed = assets.filter((asset) => !afterAssets.some((next) => next.id === asset.id && next.impact >= asset.impact - 1)).map((asset) => asset.id);
    const copy = FIX_COPY[op];
    fixes.push({
      id: `${workload.id}:${op}`,
      op,
      title: copy.title,
      detail: copy.detail,
      scoreBefore: before,
      scoreAfter: after,
      shrink,
      patch: patchFor(workload, op, assets.find((asset) => asset.fixOp === op)?.file || workload.sourceFile || ""),
      removes: removed,
      afterFactors: factorsOf(afterAssets),
    });
  }
  fixes.sort((a, b) => b.shrink - a.shrink || a.title.localeCompare(b.title));

  const shown = assets.filter((asset) => asset.impact >= 22).slice(0, 6);
  const findings: Finding[] = shown.map((asset) => ({
    id: `${workload.id}:${asset.id}`,
    title: asset.title,
    detail: asset.detail,
    impact: asset.impact,
    category: asset.category,
    severity: severity(asset.impact),
    edge: asset.edge,
    file: asset.file,
    token: asset.token,
    sourceKind: asset.sourceKind,
    sourceName: asset.sourceName,
  }));
  const nodes: GraphNode[] = [
    {
      id: workload.id,
      label: workload.name,
      caption: `${workload.kind} · ${workload.namespace}`,
      impact: before,
      severity: severity(before),
      role: "workload",
      icon: "workload",
    },
    ...shown.map((asset) => ({
      id: `${workload.id}:${asset.id}`,
      label: asset.title,
      caption: asset.caption,
      impact: asset.impact,
      severity: severity(asset.impact),
      role: "asset" as const,
      icon: iconFor(asset),
      findingId: `${workload.id}:${asset.id}`,
    })),
  ];
  const edges: GraphEdge[] = shown.map((asset) => ({
    source: workload.id,
    target: `${workload.id}:${asset.id}`,
    label: asset.edge,
    findingId: `${workload.id}:${asset.id}`,
  }));

  return {
    id: workload.id,
    kind: workload.kind,
    name: workload.name,
    namespace: workload.namespace,
    serviceAccount: workload.serviceAccount,
    image: workload.image,
    score: before,
    severity: severity(before),
    summary: summary(workload, shown),
    sourceFile: workload.sourceFile,
    factors: factorsOf(assets),
    nodes,
    edges,
    findings,
    fixes,
  };
}

export interface Analysis {
  workloads: WorkloadView[];
  score: number;
  committedSecrets: { namespace: string; name: string; keys: number; file?: string }[];
}

export function analyze(manifests: Manifest[]): Analysis {
  const model = buildModel(manifests);
  const workloads = model.workloads.map((workload) => toView(workload, model)).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const committedSecrets = [...model.secrets.values()]
    .filter((secret) => secret.committed)
    .map((secret) => ({ namespace: secret.namespace, name: secret.name, keys: secret.keys, file: secret.file }));
  return { workloads, score: repoScore(workloads.map((workload) => workload.score)), committedSecrets };
}
