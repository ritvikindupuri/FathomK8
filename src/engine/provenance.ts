import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import type { Provenance } from "./types";

function git(repo: string, args: string[]): string {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
}

function lineIndex(lines: string[], token?: string): number {
  if (!token) return 0;
  const hits = lines.map((line, index) => ({ line: line.trim(), index })).filter((item) => item.line.includes(token));
  const code = hits.find((item) => !item.line.startsWith("#") && !item.line.startsWith("//"));
  return (code || hits[0])?.index ?? 0;
}

export function blameFile(repo: string, file: string, token?: string): Provenance | undefined {
  const abs = path.join(repo, file);
  if (!file || !fs.existsSync(abs)) return undefined;
  const lines = fs.readFileSync(abs, "utf8").split(/\r?\n/);
  const index = lineIndex(lines, token);
  const lineNo = index + 1;
  let output = "";
  try {
    output = git(repo, ["blame", "-L", `${lineNo},${lineNo}`, "--porcelain", "--", file]);
  } catch {
    return undefined;
  }
  const sha = output.split("\n")[0]?.split(" ")[0];
  if (!sha || sha.length < 7) return undefined;
  const author = output.match(/^author (.+)$/m)?.[1] || "Unknown";
  const email = (output.match(/^author-mail <(.+)>$/m)?.[1] || "").replace(/[<>]/g, "");
  const time = Number(output.match(/^author-time (\d+)$/m)?.[1] || "0");
  let body = "";
  try {
    body = git(repo, ["log", "-1", "--format=%B", sha]);
  } catch {
    body = output.match(/^summary (.+)$/m)?.[1] || "";
  }
  const subject = body.split("\n")[0] || output.match(/^summary (.+)$/m)?.[1] || "";
  const pr = pullRequestNumber(body);
  return {
    sha,
    short: sha.slice(0, 7),
    author,
    email,
    date: time ? new Date(time * 1000).toISOString() : new Date(0).toISOString(),
    message: subject,
    pr: pr || undefined,
    file,
    line: lineNo,
  };
}

export function pullRequestNumber(message: string): number | undefined {
  const patterns = [/Merge pull request #(\d+)\b/i, /\(#(\d+)\)\s*$/m, /github\.com\/[\w.-]+\/[\w.-]+\/pull\/(\d+)\b/];
  for (const pattern of patterns) {
    const value = Number(message.match(pattern)?.[1] || "");
    if (value) return value;
  }
  return undefined;
}

export interface SourceFile {
  file: string;
  text: string;
}

export function loadSourceIndex(repo: string): SourceFile[] {
  const out: SourceFile[] = [];
  function visit(current: string) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) visit(abs);
      else if (/\.ya?ml$/.test(entry.name) || entry.name.endsWith(".json")) {
        out.push({ file: path.relative(repo, abs).split(path.sep).join("/"), text: fs.readFileSync(abs, "utf8") });
      }
    }
  }
  visit(repo);
  return out;
}

export function matchSource(index: SourceFile[], kind?: string, name?: string, token?: string): string | undefined {
  const hits = index.filter((entry) => {
    if (kind && !entry.text.includes(`kind: ${kind}`)) return false;
    if (name && !entry.text.includes(`name: ${name}`)) return false;
    return true;
  });
  if (token) {
    const hit = hits.find((entry) => entry.text.includes(token));
    if (hit) return hit.file;
  }
  return hits[0]?.file;
}
