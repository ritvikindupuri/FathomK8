import { ready } from "@/server/boot";
import { store } from "@/server/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  await ready();
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      send("snapshot", store.get());
      const unsubscribe = store.subscribe(send);
      store.setViewers(store.get().viewers + 1);
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          cleanup();
        }
      }, 20_000);
      cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
        store.setViewers(Math.max(0, store.get().viewers - 1));
      };
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
