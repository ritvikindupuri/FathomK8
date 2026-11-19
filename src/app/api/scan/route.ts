import { ready, scanPublicRepo } from "@/server/boot";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  await ready();
  const text = await request.text();
  let url = "";
  if (text.trim()) {
    try {
      url = String((JSON.parse(text) as { url?: unknown }).url || "").trim();
    } catch {
      return Response.json({ ok: false, error: "Expected JSON." }, { status: 400 });
    }
  }
  if (!url) return Response.json({ ok: false, error: "Paste a GitHub repository URL." }, { status: 400 });
  try {
    const scan = await scanPublicRepo(url);
    return Response.json({ ok: true, id: scan.id, score: scan.score, commit: scan.commit });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Scan failed.";
    return Response.json({ ok: false, error: message }, { status: 400 });
  }
}
