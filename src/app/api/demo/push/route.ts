import { ready, simulatePush } from "@/server/boot";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  await ready();
  const result = await simulatePush();
  return Response.json(result);
}
