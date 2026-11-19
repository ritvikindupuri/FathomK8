import { ready, rescanAll, scanPublicRepo } from "@/server/boot";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  await ready();
  const text = await request.text();
  if (text.trim()) {
    let url = "";
    try {
      url = String((JSON.parse(text) as { url?: unknown }).url || "");
    } catch {
      return Response.json({ ok: false, error: "Expected JSON." }, { status: 400 });
    }
    if (url) {
      try {
        const scan = await scanPublicRepo(url);
        return Response.json({ ok: true, id: scan.id, score: scan.score });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Scan failed.";
        return Response.json({ ok: false, error: message }, { status: 400 });
      }
    }
  }
  await rescanAll();
  return Response.json({ ok: true });
}
