import path from "path";
import { scanRepository } from "@/engine/scan-repo";
import { demoRoot, ensureDemos, toggleEmergency } from "./demo-repos";
import { cloneAndScan, defaultBranch, githubOwner, headSha, matchingRepos, parseGithubRepoUrl } from "./github";
import { store } from "./store";

let readyPromise: Promise<void> | null = null;
let pollStarted = false;
const seenSha = new Map<string, string>();

export function ready(): Promise<void> {
  if (!readyPromise) readyPromise = boot();
  return readyPromise;
}

async function scanDemos() {
  const { payments, gitops } = await ensureDemos();
  const [paymentsScan, gitopsScan] = await Promise.all([
    scanRepository({ dir: payments, owner: "demo", name: "payments-platform", source: "demo" }),
    scanRepository({ dir: gitops, owner: "demo", name: "platform-gitops", source: "demo" }),
  ]);
  return [paymentsScan, gitopsScan];
}

async function boot() {
  const demos = await scanDemos();
  const token = process.env.GITHUB_TOKEN;
  store.patch({
    owner: githubOwner(),
    repos: demos,
    scanning: false,
    lastEvent: "Demo corpus ready",
    github: token
      ? { status: "discovering", detail: `Looking through ${githubOwner()}'s repositories.` }
      : { status: "no-token", detail: "Demo corpus only. Set GITHUB_TOKEN to scan ritvikindupuri." },
  });
  if (token) {
    void discover().catch((error: unknown) => {
      store.patch({
        scanning: false,
        github: { status: "error", detail: error instanceof Error ? error.message : "GitHub scan failed." },
      });
    });
    startPolling();
  }
}

export async function discover() {
  const token = process.env.GITHUB_TOKEN;
  const owner = githubOwner();
  store.patch({
    scanning: true,
    github: { status: "discovering", detail: `Looking through ${owner}'s repositories.` },
  });
  const matched = await matchingRepos(token);
  store.patch({
    github: {
      status: "scanning",
      detail: matched.length
        ? `Scanning ${matched.length} ${matched.length === 1 ? "repository" : "repositories"} with Kubernetes manifests.`
        : `No Kubernetes manifests in the repositories checked for ${owner}.`,
    },
  });
  for (const repo of matched) {
    try {
      const scan = await cloneAndScan(owner, repo, token);
      seenSha.set(scan.id, scan.commit);
      store.upsert(scan, `${repo.name} scanned`);
    } catch (error) {
      store.upsert(
        {
          id: `${owner}/${repo.name}`,
          owner,
          name: repo.name,
          source: "github",
          htmlUrl: repo.htmlUrl,
          branch: repo.branch,
          commit: "",
          scannedAt: new Date().toISOString(),
          score: 0,
          severity: "low",
          workloads: [],
          timeline: [],
          notes: [],
          error: error instanceof Error ? error.message : "Scan failed.",
          committedSecrets: [],
        },
        `${repo.name} failed`,
      );
    }
  }
  store.patch({
    scanning: false,
    github: {
      status: "ready",
      detail: matched.length
        ? `Scanned ${matched.length} of ${owner}'s repositories that contain manifests.`
        : `No Kubernetes manifests found for ${owner}.`,
    },
  });
}

export async function rescanAll() {
  store.patch({ scanning: true, lastEvent: "Scanning" });
  const demos = await scanDemos();
  const githubRepos = store.get().repos.filter((repo) => repo.source === "github");
  store.patch({ repos: [...demos, ...githubRepos], scanning: !!process.env.GITHUB_TOKEN, lastEvent: "Demo corpus updated" });
  if (process.env.GITHUB_TOKEN) await discover();
}

export async function simulatePush() {
  store.patch({ scanning: true });
  const dir = path.join(demoRoot(), "payments-platform");
  const action = await toggleEmergency(dir);
  const scan = await scanRepository({ dir, owner: "demo", name: "payments-platform", source: "demo" });
  const repos = [...store.get().repos.filter((repo) => repo.id !== scan.id), scan];
  store.patch({
    repos,
    scanning: false,
    lastEvent: action === "added" ? "payments-platform · emergency backup added" : "payments-platform · emergency backup reverted",
  });
  return { action, score: scan.score };
}

export async function scanPublicRepo(url: string) {
  const parsed = parseGithubRepoUrl(url);
  if (!parsed) throw new Error("Use a public GitHub URL, like https://github.com/owner/repo.");
  const branch = await defaultBranch(parsed.owner, parsed.name);
  store.patch({ scanning: true, lastEvent: `Cloning ${parsed.owner}/${parsed.name}` });
  try {
    const scan = await cloneAndScan(parsed.owner, parsed.name, undefined, branch);
    seenSha.set(scan.id, scan.commit);
    store.upsert(scan, `${parsed.name} scanned`);
    store.patch({
      scanning: false,
      github: { status: "ready", detail: `Public repository ${parsed.owner}/${parsed.name}.` },
    });
    return scan;
  } catch (error) {
    store.patch({ scanning: false, lastEvent: "Public scan failed" });
    throw error;
  }
}

export async function scanPushed(name: string, branch?: string) {
  const token = process.env.GITHUB_TOKEN;
  const owner = githubOwner();
  store.patch({ scanning: true, lastEvent: `${name} push received` });
  const scan = await cloneAndScan(owner, name, token, branch);
  seenSha.set(scan.id, scan.commit);
  const repos = [...store.get().repos.filter((repo) => repo.id !== scan.id), scan];
  store.patch({ repos, scanning: false, lastEvent: `${name} updated from push` });
}

function startPolling() {
  if (pollStarted) return;
  pollStarted = true;
  const interval = Number(process.env.POLL_INTERVAL_MS || 120_000);
  if (!interval) return;
  const timer = setInterval(() => {
    void poll().catch((error: unknown) => {
      store.patch({ github: { status: "error", detail: error instanceof Error ? error.message : "Polling failed." } });
    });
  }, interval);
  timer.unref?.();
}

async function poll() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return;
  const repos = store.get().repos.filter((repo) => repo.source === "github" && repo.branch);
  for (const repo of repos) {
    const sha = await headSha(repo.owner, repo.name, repo.branch, token);
    if (!sha || sha === seenSha.get(repo.id) || sha === repo.commit) continue;
    const scan = await cloneAndScan(repo.owner, repo.name, token, repo.branch);
    seenSha.set(scan.id, scan.commit);
    store.upsert(scan, `${repo.name} changed on ${repo.branch}`);
  }
}
