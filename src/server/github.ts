import { execFile } from "child_process";
import fs from "fs/promises";
import path from "path";
import { promisify } from "util";
import { scanRepository } from "@/engine/scan-repo";
import type { RepoScan } from "@/engine/types";

const exec = promisify(execFile);

function gitEnv(token?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
  if (token) {
    env.GIT_CONFIG_COUNT = "1";
    env.GIT_CONFIG_KEY_0 = "http.extraheader";
    env.GIT_CONFIG_VALUE_0 = `AUTHORIZATION: bearer ${token}`;
  }
  return env;
}

async function github(url: string, token?: string): Promise<{ data: unknown }> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "fathom",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(url, { headers });
  if (response.status === 403 || response.status === 429) {
    throw new Error("GitHub rate limit reached. Set GITHUB_TOKEN or wait before scanning again.");
  }
  if (!response.ok) throw new Error(`GitHub returned ${response.status} for ${new URL(url).pathname}`);
  return { data: await response.json() };
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

export async function defaultBranch(owner: string, name: string, token?: string): Promise<string> {
  try {
    const { data } = await github(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, token);
    const branch = (data as { default_branch?: string }).default_branch;
    if (branch && /^[\w./-]+$/.test(branch)) return branch;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("rate limit")) throw error;
    return "main";
  }
  return "main";
}

export async function remoteHead(owner: string, repo: string, branch: string, token?: string): Promise<string | undefined> {
  if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo) || !/^[\w./-]+$/.test(branch)) return undefined;
  try {
    const url = `https://github.com/${owner}/${repo}.git`;
    const result = await exec("git", ["ls-remote", url, `refs/heads/${branch}`], { env: gitEnv(token), encoding: "utf8" });
    const sha = result.stdout.trim().split(/\s+/)[0] || "";
    return /^[0-9a-f]{40}$/.test(sha) ? sha : undefined;
  } catch {
    return undefined;
  }
}

export async function cloneAndScan(owner: string, repo: string, token?: string, branchHint?: string): Promise<RepoScan> {
  const name = safeRepo(repo);
  if (!/^[\w.-]+$/.test(owner)) throw new Error(`Unexpected repository owner: ${owner}`);
  const branch = branchHint && /^[\w./-]+$/.test(branchHint) ? branchHint : "main";
  const htmlUrl = `https://github.com/${owner}/${name}`;
  const dest = path.join(process.cwd(), ".data", "clones", owner, name);
  const url = `${htmlUrl}.git`;
  await fs.mkdir(path.dirname(dest), { recursive: true });
  try {
    await fs.access(path.join(dest, ".git"));
    await exec("git", ["-C", dest, "fetch", "--quiet", "--depth", "30", "origin", branch], { env: gitEnv(token) });
    await exec("git", ["-C", dest, "reset", "--quiet", "--hard", `origin/${branch}`], { env: gitEnv(token) });
  } catch {
    await fs.rm(dest, { recursive: true, force: true });
    await exec("git", ["clone", "--quiet", "--depth", "30", "--branch", branch, "--no-tags", url, dest], { env: gitEnv(token) });
  }
  return scanRepository({ dir: dest, owner, name, htmlUrl, token });
}
