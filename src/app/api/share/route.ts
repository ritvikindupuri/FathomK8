import { createShare } from "@/server/shares";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  const token = createShare();
  return Response.json({ token, path: `/s/${token}` });
}
