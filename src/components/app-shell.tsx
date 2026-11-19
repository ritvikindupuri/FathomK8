"use client";

import type { RepoScan, Snapshot, WorkloadView as Workload } from "@/engine/types";
import { Overview } from "@/components/overview";
import { RepoView } from "@/components/repo-view";
import { SectionNav, type SectionId } from "@/components/section-nav";
import { useSnapshot } from "@/components/use-snapshot";
import { WorkloadView } from "@/components/workload-view";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipProvider } from "@/components/ui/tooltip";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

interface Route {
  name: "overview" | "repo" | "missing";
  section: SectionId;
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
  if (parts.length === 0) return { name: "overview", section: "overview", token };
  if (parts[0] !== "r" || parts.length < 3) return { name: "missing", section: "overview", token };
  const owner = decodeURIComponent(parts[1]);
  const repo = decodeURIComponent(parts[2]);
  if (parts.length === 3) return { name: "repo", section: "overview", token, owner, repo };
  if (parts.length === 4 && parts[3] === "workloads") return { name: "repo", section: "workloads", token, owner, repo };
  if (parts.length === 4 && parts[3] === "graph") return { name: "repo", section: "graph", token, owner, repo };
  if (parts.length === 4 && parts[3] === "fixes") return { name: "repo", section: "fixes", token, owner, repo };
  if (parts[3] === "w" && parts.length >= 7) {
    const workload = {
      namespace: decodeURIComponent(parts[4]),
      kind: decodeURIComponent(parts[5]),
      workload: decodeURIComponent(parts[6]),
    };
    if (parts.length === 7) return { name: "repo", section: "graph", token, owner, repo, ...workload };
    if (parts.length === 8 && parts[7] === "fixes") return { name: "repo", section: "fixes", token, owner, repo, ...workload };
  }
  return { name: "missing", section: "overview", token };
}

function repoPath(base: string, repo: { owner: string; name: string }) {
  return `${base}/r/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;
}

function workloadPath(base: string, repo: { owner: string; name: string }, workload: Workload) {
  return `${repoPath(base, repo)}/w/${encodeURIComponent(workload.namespace)}/${encodeURIComponent(workload.kind)}/${encodeURIComponent(workload.name)}`;
}

export function AppShell() {
  const pathname = usePathname();
  const router = useRouter();
  const route = parseRoute(pathname);
  const { snapshot } = useSnapshot();
  const [shareOpen, setShareOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
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

  async function share() {
    const response = await fetch("/api/share", { method: "POST" });
    const body = (await response.json()) as { path: string };
    setShareUrl(`${window.location.origin}${body.path}`);
    setCopied(false);
    setShareOpen(true);
  }

  async function onScan(event: FormEvent) {
    event.preventDefault();
    const url = query.trim();
    if (!url) {
      setScanError("Paste a GitHub repository URL.");
      return;
    }
    setScanError(null);
    setPending(true);
    try {
      const response = await fetch("/api/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const body = (await response.json()) as { ok?: boolean; id?: string; error?: string };
      if (!response.ok || !body.ok || !body.id || !body.id.includes("/")) {
        setScanError(body.error || "That repository could not be scanned.");
        return;
      }
      const slash = body.id.indexOf("/");
      const owner = body.id.slice(0, slash);
      const name = body.id.slice(slash + 1);
      setQuery("");
      router.push(`${base}/r/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`);
    } catch {
      setScanError("That repository could not be scanned.");
    } finally {
      setPending(false);
    }
  }

  const ready = linkState !== "checking" && linkState !== "bad" && snapshot;
  const currentRepo = snapshot?.repos.find((item) => item.owner === route.owner && item.name === route.repo);
  const ranked = [...(snapshot?.repos ?? [])].sort((a, b) => b.score - a.score);
  const navRepo = currentRepo || ranked[0];
  const currentWorkload = currentRepo?.workloads.find(
    (item) => item.namespace === route.namespace && item.kind === route.kind && item.name === route.workload,
  );
  const navWorkload = currentWorkload || navRepo?.workloads[0];

  return (
    <TooltipProvider delayDuration={250}>
      <div className="min-h-screen">
        <header className="sticky top-0 z-20 border-b border-border bg-background">
          <div className="mx-auto flex max-w-6xl flex-col gap-4 px-8 py-4 lg:flex-row lg:items-center">
            <div className="flex items-center gap-4">
              <Link href={base || "/"} className="text-lg font-semibold tracking-tight">
                Fathom
              </Link>
              <label className="sr-only" htmlFor="repo-switch">
                Repository
              </label>
              <select
                id="repo-switch"
                className="h-10 min-w-48 rounded-md border border-border bg-background px-3 text-base text-foreground"
                value={currentRepo ? `${currentRepo.owner}/${currentRepo.name}` : ""}
                onChange={(event) => {
                  const value = event.target.value;
                  if (!value) {
                    router.push(base || "/");
                    return;
                  }
                  const slash = value.indexOf("/");
                  const owner = value.slice(0, slash);
                  const name = value.slice(slash + 1);
                  router.push(`${base}/r/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`);
                }}
              >
                <option value="">All repositories</option>
                {snapshot?.repos.map((repo) => (
                  <option key={repo.id} value={`${repo.owner}/${repo.name}`}>
                    {`${repo.owner}/${repo.name}`}
                  </option>
                ))}
              </select>
            </div>
            {readonly ? null : (
              <form className="flex flex-1 flex-wrap items-center gap-2 lg:justify-end" onSubmit={(event) => void onScan(event)}>
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="https://github.com/owner/repo"
                  aria-label="GitHub repository URL"
                  className="w-full max-w-md lg:ml-auto"
                  disabled={pending}
                />
                <Button type="submit" disabled={pending || snapshot?.scanning}>
                  {pending || snapshot?.scanning ? "Scanning" : "Scan"}
                </Button>
                <Button type="button" variant="ghost" onClick={() => void share()}>
                  Share
                </Button>
              </form>
            )}
          </div>
          {scanError ? (
            <p role="alert" className="mx-auto max-w-6xl px-8 pb-4 text-base text-critical">
              {scanError}
            </p>
          ) : null}
        </header>
        {ready ? (
          <div className="border-b border-border">
            <div className="mx-auto max-w-6xl px-8">
              <SectionNav
                current={route.name === "overview" || route.name === "missing" ? "overview" : route.section}
                overviewHref={currentRepo ? repoPath(base, currentRepo) : base || "/"}
                workloadsHref={navRepo ? `${repoPath(base, navRepo)}/workloads` : undefined}
                graphHref={navRepo && navWorkload ? workloadPath(base, navRepo, navWorkload) : navRepo ? `${repoPath(base, navRepo)}/graph` : undefined}
                fixesHref={navRepo && navWorkload ? `${workloadPath(base, navRepo, navWorkload)}/fixes` : navRepo ? `${repoPath(base, navRepo)}/fixes` : undefined}
              />
            </div>
          </div>
        ) : null}
        {linkState === "bad" ? (
          <main className="mx-auto max-w-6xl px-8 py-20 text-base text-muted">This link is not valid.</main>
        ) : !snapshot || linkState === "checking" ? (
          <main className="mx-auto max-w-6xl px-8 py-20 text-base text-muted">Reading configuration…</main>
        ) : (
          <Body route={route} snapshot={snapshot} base={base} />
        )}
      </div>
      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogContent>
          <DialogTitle className="text-lg">Share a read-only link</DialogTitle>
          <DialogDescription className="text-base leading-7">Anyone with this link sees the same results as they update. They cannot scan a repository or create another link.</DialogDescription>
          <div className="mt-5 flex gap-2">
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
  if (route.name === "overview") return <Overview repos={snapshot.repos} base={base} />;
  const repo = snapshot.repos.find((item) => item.owner === route.owner && item.name === route.repo);
  if (!repo || route.name === "missing") {
    return (
      <main className="mx-auto max-w-6xl px-8 py-20 text-base text-muted">
        That page does not exist.{" "}
        <Link href={base || "/"} className="text-foreground underline">
          Back to repositories.
        </Link>
      </main>
    );
  }
  if (route.section === "overview" || route.section === "workloads") {
    return <RepoView repo={repo} base={base} section={route.section} />;
  }
  return <WorkloadSection repo={repo} route={route} base={base} />;
}

function WorkloadSection({ repo, route, base }: { repo: RepoScan; route: Route; base: string }) {
  const requested = route.workload
    ? repo.workloads.find((item) => item.namespace === route.namespace && item.kind === route.kind && item.name === route.workload)
    : repo.workloads[0];
  if (route.workload && !requested) {
    return (
      <main className="mx-auto max-w-6xl px-8 py-20 text-base text-muted">
        That workload is not in the latest scan.{" "}
        <Link href={repoPath(base, repo)} className="text-foreground underline">
          Back to {repo.name}.
        </Link>
      </main>
    );
  }
  if (!requested) {
    return (
      <main className="mx-auto max-w-6xl px-8 py-20 text-base text-muted">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">{repo.name}</h1>
        <p className="mt-4">This repository has no workloads in the rendered configuration.</p>
      </main>
    );
  }
  return <WorkloadView repo={repo} workload={requested} base={base} section={route.section === "fixes" ? "fixes" : "graph"} />;
}
