"use client";

import type { Snapshot } from "@/engine/types";
import { Overview } from "@/components/overview";
import { RepoView } from "@/components/repo-view";
import { useSnapshot } from "@/components/use-snapshot";
import { WorkloadView } from "@/components/workload-view";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipProvider } from "@/components/ui/tooltip";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

interface Route {
  name: "overview" | "repo" | "workload" | "missing";
  token?: string;
  owner?: string;
  repo?: string;
  namespace?: string;
  kind?: string;
  workload?: string;
}

function parseRoute(pathname: string): Route {
  const parts = pathname.split("/").filter(Boolean);
  let token: string | undefined;
  if (parts[0] === "s" && parts[1]) {
    token = parts[1];
    parts.splice(0, 2);
  }
  if (parts.length === 0) return { name: "overview", token };
  if (parts[0] === "r" && parts.length === 3) return { name: "repo", token, owner: decodeURIComponent(parts[1]), repo: decodeURIComponent(parts[2]) };
  if (parts[0] === "r" && parts[3] === "w" && parts.length === 7) {
    return {
      name: "workload",
      token,
      owner: decodeURIComponent(parts[1]),
      repo: decodeURIComponent(parts[2]),
      namespace: decodeURIComponent(parts[4]),
      kind: decodeURIComponent(parts[5]),
      workload: decodeURIComponent(parts[6]),
    };
  }
  return { name: "missing", token };
}

export function AppShell() {
  const pathname = usePathname();
  const route = parseRoute(pathname);
  const { snapshot, live } = useSnapshot();
  const [shareOpen, setShareOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [linkState, setLinkState] = useState<"checking" | "ok" | "bad">(route.token ? "checking" : "ok");
  const readonly = Boolean(route.token);
  const base = route.token ? `/s/${route.token}` : "";

  useEffect(() => {
    if (!route.token) return;
    let cancelled = false;
    void fetch(`/api/share/${route.token}`).then((response) => {
      if (!cancelled) setLinkState(response.ok ? "ok" : "bad");
    });
    return () => {
      cancelled = true;
    };
  }, [route.token]);

  async function scan() {
    await fetch("/api/scan", { method: "POST" });
  }

  async function simulate() {
    await fetch("/api/demo/push", { method: "POST" });
  }

  async function share() {
    const response = await fetch("/api/share", { method: "POST" });
    const body = (await response.json()) as { path: string };
    setShareUrl(`${window.location.origin}${body.path}`);
    setCopied(false);
    setShareOpen(true);
  }

  return (
    <TooltipProvider delayDuration={250}>
      <div className="min-h-screen">
        <header className="sticky top-0 z-20 border-b border-border bg-background">
          <div className="mx-auto flex h-12 max-w-6xl items-center gap-4 px-6">
            <Link href={base || "/"} className="text-sm font-medium tracking-tight">
              Fathom
            </Link>
            <span className="text-sm text-muted">{snapshot?.owner || "ritvikindupuri"}</span>
            <div className="ml-auto flex items-center gap-3">
              {snapshot?.lastEvent ? <span className="hidden max-w-56 truncate text-xs text-muted lg:inline">{snapshot.lastEvent}</span> : null}
              <span className="flex items-center gap-1.5 text-xs text-muted">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: live ? "var(--ok)" : "var(--medium)" }} />
                {live ? "Live" : "Reconnecting"}
                {snapshot ? <span className="tabular-nums">{snapshot.viewers}</span> : null}
              </span>
              {readonly ? null : (
                <>
                  <Button variant="ghost" size="sm" onClick={() => void simulate()} disabled={snapshot?.scanning}>
                    Simulate push
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => void scan()} disabled={snapshot?.scanning}>
                    {snapshot?.scanning ? "Scanning" : "Scan"}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => void share()}>
                    Share
                  </Button>
                </>
              )}
            </div>
          </div>
        </header>
        {linkState === "bad" ? (
          <main className="mx-auto max-w-5xl px-6 py-16 text-sm text-muted">This link is not valid.</main>
        ) : !snapshot || linkState === "checking" ? (
          <main className="mx-auto max-w-5xl px-6 py-16 text-sm text-muted">Scanning manifests…</main>
        ) : (
          <Body route={route} snapshot={snapshot} base={base} />
        )}
      </div>
      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogContent>
          <DialogTitle>Share read-only link</DialogTitle>
          <DialogDescription>Anyone with this link sees the same live results. They cannot scan or simulate pushes.</DialogDescription>
          <div className="mt-4 flex gap-2">
            <Input readOnly value={shareUrl} aria-label="Share link" />
            <Tooltip content="Copy link">
              <Button
                variant="outline"
                onClick={() => {
                  void navigator.clipboard.writeText(shareUrl).then(() => setCopied(true));
                }}
              >
                {copied ? "Copied" : "Copy"}
              </Button>
            </Tooltip>
          </div>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}

function Body({ route, snapshot, base }: { route: Route; snapshot: Snapshot; base: string }) {
  if (route.name === "overview") {
    return <Overview repos={snapshot.repos} githubDetail={snapshot.github.detail} base={base} />;
  }
  const repo = snapshot.repos.find((item) => item.owner === route.owner && item.name === route.repo);
  if (!repo || route.name === "missing") {
    return (
      <main className="mx-auto max-w-5xl px-6 py-16 text-sm text-muted">
        That page does not exist. <Link href={base || "/"} className="text-foreground">Back to repositories.</Link>
      </main>
    );
  }
  if (route.name === "repo") return <RepoView repo={repo} base={base} />;
  const workload = repo.workloads.find((item) => item.namespace === route.namespace && item.kind === route.kind && item.name === route.workload);
  if (!workload) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-16 text-sm text-muted">
        That workload is not in the latest scan. <Link href={`${base}/r/${repo.owner}/${repo.name}`} className="text-foreground">Back to {repo.name}.</Link>
      </main>
    );
  }
  return <WorkloadView repo={repo} workload={workload} base={base} />;
}
