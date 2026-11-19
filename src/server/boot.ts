import { missingRenderTools } from "@/engine/render";
import type { RepoScan } from "@/engine/types";
import { remember, readTracked } from "./catalog";
import { cloneAndScan, defaultBranch, parseGithubRepoUrl, remoteHead } from "./github";
import { store } from "./store";

let readyPromise: Promise<void> | null = null;
let pollStarted = false;
let polling = false;
const seenSha = new Map<string, string>();

export function ready(): Promise<void> {
  if (!readyPromise) readyPromise = boot();
  return readyPromise;
}

function warnIfRenderToolsMissing() {
  const missing = missingRenderTools();
  if (missing.length === 0) return;
  console.warn(
    `Fathom: ${missing.join(" and ")} not found on PATH. Helm charts and Kustomize overlays in a scanned repository cannot be rendered. Install both and restart. Commands are in the README under Setup.`,
  );
}

function watchingDetail(): string {
  const count = store.get().repos.length;
  if (count === 0) return "Paste a GitHub repository URL to scan it.";
  if (count === 1) return "Watching 1 repository for new commits.";
  return `Watching ${count} repositories for new commits.`;
}

function failedScan(owner: string, name: string, branch: string, message: string): RepoScan {
  return {
    id: `${owner}/${name}`,
    owner,
    name,
    source: "github",
    htmlUrl: `https://github.com/${owner}/${name}`,
    branch,
    commit: "",
    scannedAt: new Date().toISOString(),
    score: 0,
    severity: "low",
    workloads: [],
    timeline: [],
    notes: [],
    error: message,
    committedSecrets: [],
  };
}

async function boot() {
  warnIfRenderToolsMissing();
  store.patch({
    repos: [],
    scanning: false,
    lastEvent: null,
    github: { status: "ready", detail: "Paste a GitHub repository URL to scan it." },
  });
  const tracked = await readTracked();
  if (tracked.length > 0) {
    store.patch({ scanning: true });
    const token = process.env.GITHUB_TOKEN || undefined;
    for (const repo of tracked) {
      try {
        const scan = await cloneAndScan(repo.owner, repo.name, token, repo.branch);
        seenSha.set(scan.id, scan.commit);
        store.upsert(scan);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Scan failed.";
        store.upsert(failedScan(repo.owner, repo.name, repo.branch, message));
      }
    }
    store.patch({ scanning: false, github: { status: "ready", detail: watchingDetail() } });
  }
  startPolling();
}

export async function scanPublicRepo(url: string) {
  const parsed = parseGithubRepoUrl(url);
  if (!parsed) throw new Error("Use a GitHub URL, like https://github.com/owner/repo.");
  const token = process.env.GITHUB_TOKEN || undefined;
  store.patch({ scanning: true, lastEvent: `Cloning ${parsed.owner}/${parsed.name}` });
  try {
    const branch = await defaultBranch(parsed.owner, parsed.name, token);
    const scan = await cloneAndScan(parsed.owner, parsed.name, token, branch);
    seenSha.set(scan.id, scan.commit);
    await remember({ owner: scan.owner, name: scan.name, branch: scan.branch });
    store.upsert(scan, `${scan.owner}/${scan.name} scanned`);
    store.patch({ scanning: false, github: { status: "ready", detail: watchingDetail() } });
    return scan;
  } catch (error) {
    store.patch({ scanning: false, github: { status: "ready", detail: watchingDetail() } });
    throw error;
  }
}

export async function scanPushed(owner: string, name: string, branch?: string): Promise<boolean> {
  const existing = store.get().repos.find((repo) => repo.owner.toLowerCase() === owner.toLowerCase() && repo.name.toLowerCase() === name.toLowerCase());
  if (!existing) return false;
  const token = process.env.GITHUB_TOKEN || undefined;
  store.patch({ scanning: true, lastEvent: `${existing.owner}/${existing.name} push received` });
  try {
    const scan = await cloneAndScan(existing.owner, existing.name, token, branch || existing.branch);
    seenSha.set(scan.id, scan.commit);
    await remember({ owner: scan.owner, name: scan.name, branch: scan.branch });
    store.upsert(scan, `${scan.owner}/${scan.name} updated from push`);
    store.patch({ scanning: false, github: { status: "ready", detail: watchingDetail() } });
    return true;
  } catch (error) {
    store.patch({
      scanning: false,
      github: { status: "error", detail: error instanceof Error ? error.message : "Rescan failed." },
    });
    throw error;
  }
}

function startPolling() {
  if (pollStarted) return;
  pollStarted = true;
  const raw = process.env.POLL_INTERVAL_MS;
  const interval = raw === undefined || raw === "" ? 120_000 : Number(raw);
  if (!interval) return;
  const timer = setInterval(() => {
    void poll().catch((error: unknown) => {
      store.patch({
        scanning: false,
        github: { status: "error", detail: error instanceof Error ? error.message : "Polling failed." },
      });
    });
  }, interval);
  timer.unref?.();
}

async function poll() {
  if (polling || store.get().scanning) return;
  polling = true;
  try {
    const token = process.env.GITHUB_TOKEN || undefined;
    const repos = store.get().repos.filter((repo) => repo.branch);
    let changed = false;
    for (const repo of repos) {
      const sha = await remoteHead(repo.owner, repo.name, repo.branch, token);
      if (!sha || sha === seenSha.get(repo.id) || sha === repo.commit) continue;
      changed = true;
      store.patch({ scanning: true });
      try {
        const scan = await cloneAndScan(repo.owner, repo.name, token, repo.branch);
        seenSha.set(scan.id, scan.commit);
        store.upsert(scan, `${repo.owner}/${repo.name} changed on ${repo.branch}`);
      } catch (error) {
        store.patch({
          github: { status: "error", detail: error instanceof Error ? error.message : "Rescan failed." },
        });
      } finally {
        store.patch({ scanning: false });
      }
    }
    if (changed && store.get().github.status !== "error") {
      store.patch({ github: { status: "ready", detail: watchingDetail() } });
    }
  } finally {
    polling = false;
  }
}
