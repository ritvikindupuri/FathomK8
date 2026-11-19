import type { RepoScan, Snapshot } from "@/engine/types";

type Listener = (event: string, data: unknown) => void;

function createStore() {
  let snapshot: Snapshot = {
    revision: 0,
    owner: "",
    viewers: 0,
    scanning: false,
    lastEvent: null,
    github: { status: "ready", detail: "Paste a GitHub repository URL to scan it." },
    repos: [],
  };
  const listeners = new Set<Listener>();

  const emit = (event: string, data: unknown) => {
    for (const listener of listeners) listener(event, data);
  };

  return {
    get: () => snapshot,
    subscribe(listener: Listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    patch(partial: Partial<Snapshot>) {
      snapshot = { ...snapshot, ...partial, revision: snapshot.revision + 1 };
      emit("snapshot", snapshot);
    },
    upsert(repo: RepoScan, lastEvent?: string) {
      const repos = [...snapshot.repos.filter((item) => item.id !== repo.id), repo];
      snapshot = {
        ...snapshot,
        repos,
        lastEvent: lastEvent ?? snapshot.lastEvent,
        revision: snapshot.revision + 1,
      };
      emit("snapshot", snapshot);
    },
    setViewers(viewers: number) {
      snapshot = { ...snapshot, viewers };
      emit("viewers", { viewers });
    },
  };
}

const globalStore = globalThis as typeof globalThis & { __fathom?: ReturnType<typeof createStore> };

export const store = globalStore.__fathom ?? createStore();
if (!globalStore.__fathom) globalStore.__fathom = store;
