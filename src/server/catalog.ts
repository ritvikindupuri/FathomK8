import fs from "fs/promises";
import path from "path";

export interface TrackedRepo {
  owner: string;
  name: string;
  branch: string;
}

function file(): string {
  return path.join(process.cwd(), ".data", "scanned.json");
}

export async function readTracked(): Promise<TrackedRepo[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(file(), "utf8")) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is TrackedRepo => {
      if (!item || typeof item !== "object") return false;
      const repo = item as TrackedRepo;
      return Boolean(repo.owner && repo.name && repo.branch);
    });
  } catch {
    return [];
  }
}

export async function remember(repo: TrackedRepo): Promise<void> {
  const all = await readTracked();
  const next = [
    ...all.filter((item) => item.owner.toLowerCase() !== repo.owner.toLowerCase() || item.name.toLowerCase() !== repo.name.toLowerCase()),
    repo,
  ];
  await fs.mkdir(path.dirname(file()), { recursive: true });
  await fs.writeFile(file(), JSON.stringify(next, null, 2));
}
