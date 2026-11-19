export type Severity = "critical" | "high" | "medium" | "low";

export type FindingCategory = "rbac" | "secret" | "escape" | "network" | "cloud";

export type FixOp =
  | "clear-node"
  | "clear-hostpath"
  | "clear-privilege"
  | "clear-hostns"
  | "drop-rbac"
  | "isolate-egress"
  | "unmount-secrets"
  | "scope-cloud";

export interface Provenance {
  sha: string;
  short: string;
  author: string;
  email: string;
  date: string;
  message: string;
  pr?: number;
  file: string;
  line?: number;
}

export interface Finding {
  id: string;
  title: string;
  detail: string;
  impact: number;
  category: FindingCategory;
  severity: Severity;
  edge: string;
  file?: string;
  token?: string;
  sourceKind?: string;
  sourceName?: string;
  provenance?: Provenance;
}

export interface ScoreFactor {
  id: string;
  label: string;
  points: number;
}

export interface Fix {
  id: string;
  op: FixOp;
  title: string;
  detail: string;
  scoreBefore: number;
  scoreAfter: number;
  shrink: number;
  patch: string;
  removes: string[];
  afterFactors: ScoreFactor[];
}

export type NodeIcon = "workload" | "admin" | "rbac" | "node" | "secret" | "cloud" | "network" | "account";

export interface GraphNode {
  id: string;
  label: string;
  caption: string;
  impact: number;
  severity: Severity;
  role: "workload" | "asset";
  icon: NodeIcon;
  findingId?: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  label: string;
  findingId?: string;
}

export interface WorkloadView {
  id: string;
  kind: string;
  name: string;
  namespace: string;
  serviceAccount: string;
  image: string;
  score: number;
  severity: Severity;
  summary: string;
  sourceFile?: string;
  factors: ScoreFactor[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  findings: Finding[];
  fixes: Fix[];
}

export interface TimelinePoint {
  sha: string;
  short: string;
  date: string;
  author: string;
  message: string;
  score: number;
  pr?: number;
}

export interface CommittedSecret {
  namespace: string;
  name: string;
  keys: number;
  file?: string;
}

export interface PathCut {
  title: string;
  detail: string;
  paths: number;
}

export interface StandingNote {
  title: string;
  detail: string;
}

export interface RepoScan {
  id: string;
  owner: string;
  name: string;
  source: "github";
  htmlUrl?: string;
  branch: string;
  commit: string;
  scannedAt: string;
  score: number;
  severity: Severity;
  workloads: WorkloadView[];
  timeline: TimelinePoint[];
  notes: string[];
  error?: string;
  committedSecrets: CommittedSecret[];
  cuts?: PathCut[];
  standing?: StandingNote[];
  caveat?: string;
}

export interface GithubStatus {
  status: "scanning" | "ready" | "error";
  detail: string;
}

export interface Snapshot {
  revision: number;
  owner: string;
  viewers: number;
  scanning: boolean;
  lastEvent: string | null;
  github: GithubStatus;
  repos: RepoScan[];
}
