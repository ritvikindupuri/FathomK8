import { validShare } from "@/server/shares";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  if (!validShare(token)) return Response.json({ ok: false }, { status: 404 });
  return Response.json({ ok: true });
}
