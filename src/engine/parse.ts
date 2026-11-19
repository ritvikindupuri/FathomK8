import { parseAllDocuments } from "yaml";

export interface Manifest {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    namespace: string;
    labels: Record<string, string>;
    annotations: Record<string, string>;
  };
  spec: Record<string, unknown>;
  keyCount: number;
  committed: boolean;
  sourceFile?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") out[key] = entry;
    else if (typeof entry === "number" || typeof entry === "boolean") out[key] = String(entry);
  }
  return out;
}

function keyCount(value: unknown): number {
  if (!isRecord(value)) return 0;
  return Object.keys(value).length;
}

export function manifestsFromValue(value: unknown, file?: string, fallbackNamespace?: string): Manifest[] {
  if (Array.isArray(value)) return value.flatMap((item) => manifestsFromValue(item, file, fallbackNamespace));
  if (!isRecord(value) || typeof value.kind !== "string") return [];
  const meta = isRecord(value.metadata) ? value.metadata : {};
  const namespace = typeof meta.namespace === "string" && meta.namespace ? meta.namespace : fallbackNamespace || "default";
  if (value.kind === "List") {
    return manifestsFromValue(value.items, file, namespace === "default" ? fallbackNamespace : namespace);
  }
  const name = typeof meta.name === "string" ? meta.name : "";
  if (!name) return [];
  const dataKeys = keyCount(value.data);
  const stringKeys = keyCount(value.stringData);
  const spec = isRecord(value.spec) ? { ...value.spec } : {};
  // RBAC rules, subjects, and roleRef are siblings of metadata, not spec fields.
  if (Array.isArray(value.rules) && spec.rules === undefined) spec.rules = value.rules;
  if (Array.isArray(value.subjects) && spec.subjects === undefined) spec.subjects = value.subjects;
  if (isRecord(value.roleRef) && spec.roleRef === undefined) spec.roleRef = value.roleRef;
  if (isRecord(value.aggregationRule) && spec.aggregationRule === undefined) spec.aggregationRule = value.aggregationRule;
  if (typeof value.type === "string" && spec.type === undefined) spec.type = value.type;
  return [
    {
      apiVersion: typeof value.apiVersion === "string" ? value.apiVersion : "",
      kind: value.kind,
      metadata: {
        name,
        namespace,
        labels: stringMap(meta.labels),
        annotations: stringMap(meta.annotations),
      },
      spec,
      keyCount: dataKeys + stringKeys,
      committed: dataKeys + stringKeys > 0,
      sourceFile: file,
    },
  ];
}

export function parseYamlDocuments(text: string, file?: string): Manifest[] {
  let docs;
  try {
    docs = parseAllDocuments(text);
  } catch {
    return [];
  }
  const manifests: Manifest[] = [];
  for (const doc of docs) {
    if (doc.errors.length > 0) continue;
    const start = doc.range?.[0] ?? 0;
    // Helm prints `# Source:` after the document separator, inside the range.
    const window = text.slice(start, start + 500);
    const sourceAt = window.search(/# Source: /);
    const kindAt = window.search(/^kind:/m);
    const sourceComment =
      sourceAt >= 0 && (kindAt < 0 || sourceAt < kindAt) ? window.match(/# Source: (\S+)/)?.[1]?.trim() : undefined;
    manifests.push(...manifestsFromValue(doc.toJS(), sourceComment || file));
  }
  return manifests;
}

export function parseJsonManifests(text: string, file?: string): Manifest[] {
  try {
    return manifestsFromValue(JSON.parse(text) as unknown, file);
  } catch {
    return [];
  }
}

export function remapHelmSources(manifests: Manifest[], chartName: string, chartRoot: string): Manifest[] {
  const prefix = `${chartName}/`;
  return manifests.map((manifest) => {
    const source = manifest.sourceFile;
    if (!source || source.includes("\n")) return manifest;
    const rest = source.startsWith(prefix) ? source.slice(prefix.length) : source;
    const root = chartRoot === "." ? "" : chartRoot.replace(/\/$/, "");
    const file = root ? `${root}/${rest}` : rest;
    return { ...manifest, sourceFile: file };
  });
}
