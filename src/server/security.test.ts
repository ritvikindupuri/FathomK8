import { describe, expect, it } from "vitest";
import { looksLikeKubernetes, parseGithubRepoUrl } from "./github";
import { verifyGithubSignature } from "./webhook";
import { createHmac } from "crypto";

describe("github filters", () => {
  it("accepts charts, kustomize, and manifest paths", () => {
    expect(looksLikeKubernetes(["charts/payments/Chart.yaml"])).toBe(true);
    expect(looksLikeKubernetes(["deploy/overlays/prod/kustomization.yaml"])).toBe(true);
    expect(looksLikeKubernetes(["k8s/web/deployment.yaml"])).toBe(true);
  });

  it("reads a public GitHub URL and rejects anything else", () => {
    expect(parseGithubRepoUrl("https://github.com/ritvikindupuri/k8s-cluster-admin-escalation-mapper")).toEqual({
      owner: "ritvikindupuri",
      name: "k8s-cluster-admin-escalation-mapper",
    });
    expect(parseGithubRepoUrl("github.com/acme/charts.git")).toEqual({ owner: "acme", name: "charts" });
    expect(parseGithubRepoUrl("https://gitlab.com/acme/charts")).toBeNull();
  });

  it("ignores workflows and ordinary yaml", () => {
    expect(looksLikeKubernetes([".github/workflows/ci.yml", "README.md"])).toBe(false);
    expect(looksLikeKubernetes(["docs/config.yaml"])).toBe(false);
  });
});

describe("webhook signatures", () => {
  it("accepts a matching signature and rejects a tampered body", () => {
    const secret = "test-secret";
    const raw = JSON.stringify({ ref: "refs/heads/main" });
    const header = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
    expect(verifyGithubSignature(raw, header, secret)).toBe(true);
    expect(verifyGithubSignature(`${raw} `, header, secret)).toBe(false);
    expect(verifyGithubSignature(raw, null, secret)).toBe(false);
  });
});
