import { ready } from "@/server/boot";
import { store } from "@/server/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  await ready();
  return Response.json(store.get());
}
