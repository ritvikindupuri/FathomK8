import { severity } from "@/engine/score";
import type { ScoreFactor } from "@/engine/types";

/** Plain name for the band `severity` assigns. Ranges are 0–34, 35–64, 65–84, 85–100. */
export function bandName(score: number): "Low" | "Moderate" | "High" | "Critical" {
  const level = severity(score);
  if (level === "critical") return "Critical";
  if (level === "high") return "High";
  if (level === "medium") return "Moderate";
  return "Low";
}

export const BAND_LEGEND = "0–34 is low, 35–64 is moderate, 65–84 is high, and 85–100 is critical.";

export function scoreMeaning(score: number): string {
  return `Blast radius is ${score} out of 100, which is ${bandName(score).toLowerCase()}. It estimates how much of the cluster an attacker could reach if this workload were compromised. 100 means they could take control of the cluster.`;
}

/**
 * One reason, in plain language, using the points the scorer stored on the factor.
 * A mounted secret scores at least 64 only when its values are committed in git.
 */
export function factorSentence(factor: ScoreFactor): string {
  const extra = `(+${factor.points})`;
  if (factor.id === "rbac-admin") return `Can act as cluster admin through Kubernetes permissions ${extra}`;
  if (factor.id === "rbac-chain") return `Can reach cluster admin through a chain of other permissions ${extra}`;
  if (factor.id === "rbac-exec") return `Can open a shell inside other pods ${extra}`;
  if (factor.id === "rbac-impersonate") return `Can impersonate another user, group, or service account ${extra}`;
  if (factor.id === "rbac-bind") return `Can bind a role they do not already hold ${extra}`;
  if (factor.id === "rbac-escalate") return `Can escalate a role beyond the permissions they hold ${extra}`;
  if (factor.id === "rbac-token") return `Can request a token for another service account ${extra}`;
  if (factor.id === "rbac-mint") return `Can create a secret that issues a service account token ${extra}`;
  if (factor.id === "rbac-csr") return `Can approve client certificates for other users ${extra}`;
  if (factor.id === "rbac-policy") return `Can rewrite validating webhooks that guard the cluster ${extra}`;
  if (factor.id === "rbac-api") return `Can redirect an aggregated API to another server ${extra}`;
  if (factor.id === "rbac-secrets") return `Can read secrets in every namespace ${extra}`;
  if (factor.id === "rbac-secrets-ns") return `Can read secrets in its own namespace ${extra}`;
  if (factor.id === "rbac-pods") return `Can create pods, a step toward reaching other secrets ${extra}`;
  if (factor.id === "rbac-proxy") return `Can call node APIs through the kubelet proxy ${extra}`;
  if (factor.id === "node") {
    if (factor.label === "Node compromise") return `Can take over the node this workload runs on ${extra}`;
    return `Can reach the machine this workload runs on ${extra}`;
  }
  if (factor.id.startsWith("secret:")) {
    if (factor.points >= 64) return `Mounts the secret ${factor.label}, and that secret is stored in git ${extra}`;
    return `Mounts the secret ${factor.label} ${extra}`;
  }
  if (factor.id === "cloud") {
    if (factor.label === "scoped read role") return `Keeps a read-only cloud identity ${extra}`;
    return `Can use the cloud identity ${factor.label} ${extra}`;
  }
  if (factor.id === "svc-other") return `Can reach other services in the same namespace ${extra}`;
  if (factor.id.startsWith("svc:")) return `Can connect to the ${factor.label} service ${extra}`;
  return `${factor.label} ${extra}`;
}

/** Shown on the score tooltip only when this workload has a chained route to cluster admin. */
export function routeExplanation(factors: ScoreFactor[]): string | null {
  if (!factors.some((factor) => factor.id === "rbac-chain")) return null;
  return "Fathom starts from this workload and follows every permission it has, step by step (create a pod, read a secret, bind a role), using only what the repo's manifests grant. It shows the route to cluster admin with the fewest and most reliable steps.";
}

export function combineSentence(factors: ScoreFactor[]): string {
  if (factors.length === 0) return "Nothing beyond this workload is reachable, so the score is 0.";
  if (factors.length === 1) return "There is one reason, so the score is that reason's points.";
  return "These reasons do not add together. Each one is a way in. The score is how much of the cluster those ways cover together, and it never goes above 100.";
}
