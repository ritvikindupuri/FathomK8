import { execFile, execFileSync } from "child_process";
import fs from "fs/promises";
import path from "path";
import { promisify } from "util";
import type { Manifest } from "./parse";
import { parseJsonManifests, parseYamlDocuments, remapHelmSources } from "./parse";

const exec = promisify(execFile);

export interface RenderResult {
  manifests: Manifest[];
  notes: string[];
  error?: string;
}

function commandError(error: unknown): string {
  if (typeof error === "object" && error !== null && "stderr" in error) {
    const stderr = String((error as { stderr?: unknown }).stderr || "").trim();
    if (stderr) return stderr.split("\n")[0];
  }
  return error instanceof Error ? error.message.split("\n")[0] : String(error);
}

function toolEnv(): NodeJS.ProcessEnv {
  const home = process.env.HOME || "";
  const extra = path.join(home, ".local/bin");
  return { ...process.env, PATH: `${extra}${path.delimiter}${process.env.PATH || ""}` };
}

export function missingRenderTools(): string[] {
  const checks: { command: string; args: string[] }[] = [
    { command: "helm", args: ["version", "--client", "--short"] },
    { command: "kustomize", args: ["version"] },
  ];
  const missing: string[] = [];
  for (const check of checks) {
    try {
      execFileSync(/* turbopackIgnore: true */ check.command, check.args, { env: toolEnv(), stdio: "ignore" });
    } catch {
      missing.push(check.command);
    }
  }
  return missing;
}

async function run(command: string, args: string[], cwd: string): Promise<string> {
  const result = await exec(command, args, {
    cwd,
    env: toolEnv(),
    maxBuffer: 32 * 1024 * 1024,
  });
  return result.stdout;
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function visit(current: string) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === "node_modules" || entry.name === ".data") continue;
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(abs);
      else out.push(abs);
    }
  }
  await visit(dir);
  return out;
}

function relPosix(root: string, file: string): string {
  const rel = path.relative(root, file);
  return rel.split(path.sep).join("/");
}

function isInside(file: string, dir: string): boolean {
  if (dir === "." || dir === "") return !file.startsWith("../");
  const relative = path.relative(dir, file);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function readKustomizeResources(file: string): Promise<string[]> {
  const text = await fs.readFile(file, "utf8");
  const docs = parseYamlDocuments(text, file);
  const resources = (docs[0]?.spec as { resources?: unknown } | undefined)?.resources;
  // Kustomization fields live at the top level, not under spec. Re-read via yaml in parse only maps spec.
  const { parseAllDocuments } = await import("yaml");
  const top = parseAllDocuments(text)[0]?.toJS() as { resources?: unknown } | undefined;
  const list = Array.isArray(top?.resources) ? top.resources : Array.isArray(resources) ? resources : [];
  return list.filter((item): item is string => typeof item === "string");
}

export async function renderRepository(repoDir: string): Promise<RenderResult> {
  const files = await walk(repoDir);
  const relFiles = files.map((file) => relPosix(repoDir, file));
  const chartDirs = relFiles
    .filter((file) => file.endsWith("/Chart.yaml") || file === "Chart.yaml")
    .map((file) => path.posix.dirname(file));
  const chartRoots = chartDirs.filter((dir) => {
    return !chartDirs.some((other) => other !== dir && dir.startsWith(`${other === "." ? "" : `${other}/`}charts/`));
  });

  const kustomizeFiles = relFiles.filter((file) => /(^|\/)kustomization\.ya?ml$/.test(file));
  const kustomizeDirs = kustomizeFiles.map((file) => path.posix.dirname(file));
  const referenced = new Set<string>();
  for (const dir of kustomizeDirs) {
    const resources = await readKustomizeResources(path.join(repoDir, dir, "kustomization.yaml")).catch(async () =>
      readKustomizeResources(path.join(repoDir, dir, "kustomization.yml")),
    );
    for (const resource of resources) {
      if (resource.includes("://")) continue;
      const target = path.posix.normalize(path.posix.join(dir, resource));
      if (kustomizeDirs.includes(target)) referenced.add(target);
    }
  }
  const kustomizeRoots = kustomizeDirs.filter((dir) => !referenced.has(dir));

  const notes: string[] = [];
  const manifests: Manifest[] = [];

  for (const chart of chartRoots) {
    const chartAbs = path.join(repoDir, chart);
    let name = path.posix.basename(chartAbs);
    try {
      const chartText = await fs.readFile(path.join(chartAbs, "Chart.yaml"), "utf8");
      const parsed = parseYamlDocuments(chartText)[0];
      const chartName = (parsed?.spec as { name?: string } | undefined)?.name;
      // name is top-level
      const { parseAllDocuments } = await import("yaml");
      const top = parseAllDocuments(chartText)[0]?.toJS() as { name?: string } | undefined;
      name = top?.name || chartName || name;
      const rendered = await run("helm", ["template", name, chartAbs], repoDir);
      manifests.push(...remapHelmSources(parseYamlDocuments(rendered), name, chart));
      notes.push(chart === "." ? `Helm ${name}` : `Helm ${chart}`);
    } catch (error) {
      notes.push(`Helm ${chart} failed: ${commandError(error)}`);
    }
  }

  for (const dir of kustomizeRoots) {
    try {
      const rendered = await run("kustomize", ["build", path.join(repoDir, dir)], repoDir);
      const parsed = parseYamlDocuments(rendered).map((manifest) => ({ ...manifest, sourceFile: undefined }));
      manifests.push(...parsed);
      notes.push(`Kustomize ${dir}`);
    } catch (error) {
      notes.push(`Kustomize ${dir} failed: ${commandError(error)}`);
    }
  }

  for (const file of relFiles) {
    const yaml = /\.ya?ml$/.test(file);
    const json = file.endsWith(".json");
    if (!yaml && !json) continue;
    if (file.startsWith(".github/")) continue;
    if (/(^|\/)(Chart|values|kustomization)\.ya?ml$/.test(file)) continue;
    if (chartRoots.some((dir) => isInside(file, dir))) continue;
    if (kustomizeDirs.some((dir) => isInside(file, dir))) continue;
    const text = await fs.readFile(path.join(repoDir, file), "utf8");
    if (json && !/"apiVersion"/.test(text)) continue;
    const parsed = (yaml ? parseYamlDocuments(text, file) : parseJsonManifests(text, file)).map((manifest) => ({
      ...manifest,
      sourceFile: file,
    }));
    if (parsed.length > 0) {
      manifests.push(...parsed);
      notes.push(`Manifest ${file}`);
    }
  }

  const deduped = new Map<string, Manifest>();
  for (const manifest of manifests) {
    deduped.set(`${manifest.kind}/${manifest.metadata.namespace}/${manifest.metadata.name}`, manifest);
  }
  const list = [...deduped.values()];
  const failed = notes.some((note) => note.includes("failed"));
  return {
    manifests: list,
    notes,
    error: list.length === 0 && failed ? notes.join("; ") : undefined,
  };
}
