import { execFile } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { promisify } from "util";
import { analyze } from "./analyze";
import { blameFile, loadSourceIndex, matchSource } from "./provenance";
import { renderRepository } from "./render";
import { severity } from "./score";
import type { Finding, RepoScan, TimelinePoint } from "./types";

const exec = promisify(execFile);
const scoreCache = new Map<string, number>();
const ANALYZER_VERSION = "3";

async function git(repo: string, args: string[]): Promise<string> {
  const result = await exec("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  return result.stdout;
}

interface CommitInfo {
  sha: string;
  date: string;
  author: string;
  subject: string;
  pr?: number;
}

async function commits(repo: string, limit = 12): Promise<CommitInfo[]> {
  const raw = await git(repo, ["log", "--reverse", `-n`, String(limit), `--pretty=format:%H%x1f%aI%x1f%an%x1f%s%x1f%b%x1e`]);
  return raw
    .split("\x1e")
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [sha, date, author, subject, ...rest] = record.split("\x1f");
      const body = rest.join("\x1f");
      const pr = Number(body.match(/Demo-PR:\s*(\d+)/)?.[1] || "");
      return { sha, date, author, subject: subject?.trim() || "", pr: pr || undefined };
    });
}

async function scoreAt(repo: string, name: string, sha: string): Promise<number> {
  const key = `${ANALYZER_VERSION}:${name}:${sha}`;
  const cached = scoreCache.get(key);
  if (cached !== undefined) return cached;
  const file = path.join(process.cwd(), ".data", "cache", `${ANALYZER_VERSION}-${name}-${sha}.json`);
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8")) as { score?: number };
    if (typeof parsed.score === "number") {
      scoreCache.set(key, parsed.score);
      return parsed.score;
    }
  } catch {
    // Cache miss.
  }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fathom-"));
  try {
    await git(repo, ["worktree", "add", "--detach", "--force", dir, sha]);
    const rendered = await renderRepository(dir);
    const score = analyze(rendered.manifests).score;
    scoreCache.set(key, score);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify({ score }));
    return score;
  } finally {
    await git(repo, ["worktree", "remove", "--force", dir]).catch(() => undefined);
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function githubPull(owner: string, repo: string, sha: string, token: string): Promise<number | undefined> {
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits/${sha}/pulls`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "fathom",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) return undefined;
  const body = (await response.json()) as { number?: number }[];
  return typeof body?.[0]?.number === "number" ? body[0].number : undefined;
}

export async function scanRepository(options: {
  dir: string;
  owner: string;
  name: string;
  source: "demo" | "github";
  htmlUrl?: string;
  token?: string;
}): Promise<RepoScan> {
  const { dir, owner, name, source, htmlUrl, token } = options;
  const scannedAt = new Date().toISOString();
  const branch = (await git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => "HEAD")).trim();
  const head = (await git(dir, ["rev-parse", "HEAD"]).catch(() => "")).trim();
  const rendered = await renderRepository(dir);
  const analysis = analyze(rendered.manifests);
  const index = loadSourceIndex(dir);
  const history = await commits(dir).catch(() => [] as CommitInfo[]);

  for (const workload of analysis.workloads) {
    for (const finding of workload.findings) {
      if (!finding.file) finding.file = matchSource(index, finding.sourceKind, finding.sourceName, finding.token);
      if (finding.file) finding.provenance = blameFile(dir, finding.file, finding.token);
    }
  }

  if (token && source === "github") {
    const pending = new Map<string, Finding[]>();
    for (const workload of analysis.workloads) {
      for (const finding of workload.findings) {
        if (finding.provenance && !finding.provenance.pr) {
          const list = pending.get(finding.provenance.sha) || [];
          list.push(finding);
          pending.set(finding.provenance.sha, list);
        }
      }
    }
    let looked = 0;
    for (const [sha, findings] of pending) {
      if (looked >= 8) break;
      looked += 1;
      const pr = await githubPull(owner, name, sha, token).catch(() => undefined);
      if (!pr) continue;
      for (const finding of findings) {
        if (finding.provenance) finding.provenance.pr = pr;
      }
    }
  }

  const timeline: TimelinePoint[] = [];
  for (const commit of history) {
    const score = commit.sha === head ? analysis.score : await scoreAt(dir, name, commit.sha);
    timeline.push({
      sha: commit.sha,
      short: commit.sha.slice(0, 7),
      date: commit.date,
      author: commit.author,
      message: commit.subject,
      score,
      pr: commit.pr,
    });
  }

  return {
    id: `${owner}/${name}`,
    owner,
    name,
    source,
    htmlUrl,
    branch: branch === "HEAD" ? "main" : branch,
    commit: head,
    scannedAt,
    score: analysis.score,
    severity: severity(analysis.score),
    workloads: analysis.workloads,
    timeline,
    notes: rendered.notes,
    error: rendered.error,
    committedSecrets: analysis.committedSecrets,
  };
}
