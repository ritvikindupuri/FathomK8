import { describe, expect, it } from "vitest";
import { parseGithubRepoUrl } from "./github";
import { pullRequestNumber } from "../engine/provenance";
import { verifyGithubSignature } from "./webhook";
import { createHmac } from "crypto";

describe("github urls", () => {
  it("reads a public GitHub URL and rejects anything else", () => {
    expect(parseGithubRepoUrl("https://github.com/ritvikindupuri/k8s-cluster-admin-escalation-mapper")).toEqual({
      owner: "ritvikindupuri",
      name: "k8s-cluster-admin-escalation-mapper",
    });
    expect(parseGithubRepoUrl("github.com/acme/charts.git")).toEqual({ owner: "acme", name: "charts" });
    expect(parseGithubRepoUrl("https://gitlab.com/acme/charts")).toBeNull();
  });

  it("reads a pull request number from a real commit message", () => {
    expect(pullRequestNumber("Merge pull request #33 from acme/scope-role")).toBe(33);
    expect(pullRequestNumber("Scope the checkout role (#18)")).toBe(18);
    expect(pullRequestNumber("See https://github.com/acme/charts/pull/7")).toBe(7);
    expect(pullRequestNumber("Demo-PR: 33")).toBeUndefined();
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
