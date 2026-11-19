import { execFile } from "child_process";
import fs from "fs/promises";
import path from "path";
import { promisify } from "util";
import { scanRepository } from "@/engine/scan-repo";
import type { RepoScan } from "@/engine/types";

const exec = promisify(execFile);

export interface RemoteRepo {
  name: string;
  branch: string;
  description: string;
  fork: boolean;
  htmlUrl: string;
  pushedAt: string;
}

export function githubOwner(): string {
  return process.env.GITHUB_OWNER || "ritvikindupuri";
}

export function looksLikeKubernetes(paths: string[]): boolean {
  return paths.some((file) => {
    const lower = file.toLowerCase();
    if (/(^|\/)chart\.yaml$/.test(lower)) return true;
    if (/(^|\/)kustomization\.ya?ml$/.test(lower)) return true;
    if (!/\.ya?ml$/.test(lower) || lower.startsWith(".github/")) return false;
    if (/(^|\/)(k8s|kubernetes|manifests|helm|charts|gitops|deploy|base|overlays)\//.test(lower)) return true;
    const base = lower.split("/").pop() || "";
    return /(deployment|daemonset|statefulset|networkpolicy|clusterrole|helmfile)/.test(base);
  });
}

export function likelyKubernetesRepo(name: string, description: string): boolean {
  return /k8s|kube|helm|container|gitops|chart|manifest|cluster|falco|checkov/i.test(`${name} ${description}`);
}

function gitEnv(token?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
  if (token) {
    env.GIT_CONFIG_COUNT = "1";
    env.GIT_CONFIG_KEY_0 = "http.extraheader";
    env.GIT_CONFIG_VALUE_0 = `AUTHORIZATION: bearer ${token}`;
  }
  return env;
}

async function github(url: string, token?: string): Promise<{ data: unknown; remaining: number | null }> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "fathom",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(url, { headers });
  const remainingHeader = response.headers.get("x-ratelimit-remaining");
  const remaining = remainingHeader === null ? null : Number(remainingHeader);
  if (response.status === 403 || response.status === 429) {
    throw new Error("GitHub rate limit reached. Set GITHUB_TOKEN or wait before scanning again.");
  }
  if (!response.ok) throw new Error(`GitHub returned ${response.status} for ${new URL(url).pathname}`);
  return { data: await response.json(), remaining: Number.isFinite(remaining) ? remaining : null };
}

export async function listRepos(owner: string, token?: string): Promise<RemoteRepo[]> {
  const repos: RemoteRepo[] = [];
  for (let page = 1; page <= 3; page += 1) {
    const { data } = await github(
      `https://api.github.com/users/${encodeURIComponent(owner)}/repos?per_page=100&type=owner&sort=pushed&page=${page}`,
      token,
    );
    if (!Array.isArray(data) || data.length === 0) break;
    for (const item of data) {
      if (!item || typeof item !== "object") continue;
      const repo = item as { name?: string; fork?: boolean; default_branch?: string; description?: string | null; html_url?: string; pushed_at?: string };
      if (!repo.name) continue;
      repos.push({
        name: repo.name,
        branch: repo.default_branch || "main",
        description: repo.description || "",
        fork: !!repo.fork,
        htmlUrl: repo.html_url || `https://github.com/${owner}/${repo.name}`,
        pushedAt: repo.pushed_at || "",
      });
    }
    if (data.length < 100) break;
  }
  return repos;
}

export async function treePaths(owner: string, repo: string, branch: string, token?: string): Promise<string[]> {
  const { data } = await github(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    token,
  );
  const tree = (data as { tree?: { path?: string }[] }).tree || [];
  return tree.map((item) => item.path || "").filter(Boolean);
}

export async function headSha(owner: string, repo: string, branch: string, token?: string): Promise<string | undefined> {
  const { data } = await github(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(branch)}`,
    token,
  );
  const sha = (data as { sha?: string }).sha;
  return typeof sha === "string" ? sha : undefined;
}

function safeRepo(name: string): string {
  if (!/^[\w.-]+$/.test(name)) throw new Error(`Unexpected repository name: ${name}`);
  return name;
}

export function parseGithubRepoUrl(input: string): { owner: string; name: string } | null {
  const text = input.trim().replace(/\.git$/, "").replace(/\/$/, "");
  const match = text.match(/^(?:https?:\/\/)?github\.com\/([\w.-]+)\/([\w.-]+)$/i) || text.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (!match) return null;
  return { owner: match[1], name: match[2] };
}

export async function defaultBranch(owner: string, name: string): Promise<string> {
  try {
    const { data } = await github(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`);
    const branch = (data as { default_branch?: string }).default_branch;
    if (branch && /^[\w./-]+$/.test(branch)) return branch;
  } catch {
    return "main";
  }
  return "main";
}

export async function cloneAndScan(owner: string, repo: RemoteRepo | string, token?: string, branchHint?: string): Promise<RepoScan> {
  const name = safeRepo(typeof repo === "string" ? repo : repo.name);
  const branch = branchHint || (typeof repo === "string" ? "main" : repo.branch);
  const htmlUrl = typeof repo === "string" ? `https://github.com/${owner}/${name}` : repo.htmlUrl;
  const dest = path.join(process.cwd(), ".data", "clones", owner, name);
  const url = `https://github.com/${owner}/${name}.git`;
  await fs.mkdir(path.dirname(dest), { recursive: true });
  try {
    await fs.access(path.join(dest, ".git"));
    await exec("git", ["-C", dest, "fetch", "--quiet", "--depth", "30", "origin", branch], { env: gitEnv(token) });
    await exec("git", ["-C", dest, "reset", "--quiet", "--hard", `origin/${branch}`], { env: gitEnv(token) });
  } catch {
    await fs.rm(dest, { recursive: true, force: true });
    await exec("git", ["clone", "--quiet", "--depth", "30", "--branch", branch, "--no-tags", url, dest], { env: gitEnv(token) });
  }
  return scanRepository({ dir: dest, owner, name, source: "github", htmlUrl, token });
}

export async function matchingRepos(token?: string): Promise<RemoteRepo[]> {
  const owner = githubOwner();
  const repos = (await listRepos(owner, token)).filter((repo) => !repo.fork);
  const pool = token ? repos : repos.filter((repo) => likelyKubernetesRepo(repo.name, repo.description)).slice(0, 6);
  const matched: RemoteRepo[] = [];
  for (const repo of pool) {
    if (matched.length >= (token ? 8 : 4)) break;
    try {
      const paths = await treePaths(owner, repo.name, repo.branch, token);
      if (looksLikeKubernetes(paths)) matched.push(repo);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("rate limit")) throw error;
    }
  }
  return matched;
}
