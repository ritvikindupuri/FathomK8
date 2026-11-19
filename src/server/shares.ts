import { randomBytes } from "crypto";
import fs from "fs";
import path from "path";

const file = path.join(process.cwd(), ".data", "shares.json");

function load(): Set<string> {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

const tokens = load();

function save() {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify([...tokens]));
}

export function createShare(): string {
  const token = randomBytes(12).toString("base64url");
  tokens.add(token);
  save();
  return token;
}

export function validShare(token: string): boolean {
  return tokens.has(token);
}
