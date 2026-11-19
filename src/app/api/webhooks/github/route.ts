import { ready, scanPushed } from "@/server/boot";
import { verifyGithubSignature } from "@/server/webhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  const raw = await request.text();
  if (!secret) return Response.json({ error: "Set GITHUB_WEBHOOK_SECRET." }, { status: 503 });
  if (!verifyGithubSignature(raw, request.headers.get("x-hub-signature-256"), secret)) {
    return Response.json({ error: "Invalid signature." }, { status: 401 });
  }
  const event = request.headers.get("x-github-event");
  if (event === "ping") return Response.json({ ok: true });
  if (event !== "push") return Response.json({ ok: true, ignored: event });
  const payload = JSON.parse(raw) as {
    ref?: string;
    deleted?: boolean;
    repository?: { name?: string; owner?: { login?: string } };
  };
  const owner = payload.repository?.owner?.login || "";
  const name = payload.repository?.name || "";
  if (payload.deleted || !name || !owner) return Response.json({ ok: true, ignored: true });
  await ready();
  const branch = (payload.ref || "").replace("refs/heads/", "") || undefined;
  const updated = await scanPushed(owner, name, branch);
  return Response.json({ ok: true, ignored: !updated });
}
