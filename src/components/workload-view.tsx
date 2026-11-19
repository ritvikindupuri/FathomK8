"use client";

import type { Finding, RepoScan, WorkloadView as Workload } from "@/engine/types";
import { BlastGraph } from "@/components/blast-graph";
import { FixTip, ScoreTip, scoreTrigger } from "@/components/score-tip";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { factorSentence } from "@/lib/score-copy";
import { formatDate, severityColor } from "@/lib/format";
import Link from "next/link";
import { useMemo, useState } from "react";

function plainFinding(finding: Finding, workloadId: string): string {
  const prefix = `${workloadId}:`;
  const assetId = finding.id.startsWith(prefix) ? finding.id.slice(prefix.length) : finding.id;
  return factorSentence({ id: assetId, label: finding.title, points: finding.impact }).replace(/ \(\+\d+\)$/, "");
}

export function WorkloadView({
  repo,
  workload,
  base,
  section,
}: {
  repo: RepoScan;
  workload: Workload;
  base: string;
  section: "graph" | "fixes";
}) {
  const [selectedId, setSelectedId] = useState<string | null>(workload.findings[0]?.id || null);
  const [patch, setPatch] = useState<string | null>(null);
  const finding = workload.findings.find((item) => item.id === selectedId) || workload.findings[0];
  const assetId = finding ? finding.id.slice(workload.id.length + 1) : "";
  const related = useMemo(
    () => workload.fixes.find((fix) => fix.removes.includes(assetId)) || workload.fixes[0],
    [workload.fixes, assetId],
  );
  const repoHref = `${base}/r/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;

  return (
    <main className="mx-auto w-full max-w-6xl px-8 py-12">
      <p className="text-base text-muted">
        <Link href={repoHref} className="hover:text-foreground hover:underline">
          {repo.name}
        </Link>
      </p>
      <div className="mt-6 flex flex-wrap items-end justify-between gap-8">
        <div className="max-w-2xl">
          <h1 className="text-3xl font-semibold tracking-tight">{workload.name}</h1>
          <p className="mt-4 text-base leading-7 text-muted">
            {workload.kind} in namespace {workload.namespace}. It runs as {workload.serviceAccount || "the default service account"}.
            {workload.image ? ` Image ${workload.image}.` : ""}
          </p>
          <p className="mt-3 text-base leading-7">{workload.summary}</p>
        </div>
        <div className="text-right">
          <div className="text-sm text-muted">Blast radius</div>
          <ScoreTip factors={workload.factors} score={workload.score}>
            <button type="button" data-testid="impact-score" className={scoreTrigger("text-4xl font-semibold tabular-nums")} style={{ color: severityColor(workload.severity) }}>
              {workload.score}
            </button>
          </ScoreTip>
        </div>
      </div>

      {section === "graph" ? (
        <div className="mt-14 grid items-start gap-12 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div>
            <h2 className="text-xl font-semibold">Attack graph</h2>
            <p className="mt-3 text-base leading-7 text-muted">The path from this workload to what an attacker could reach. Select a node to read that step.</p>
            <div className="mt-6 h-[420px] border border-border bg-surface lg:h-[560px]">
              {workload.nodes.length > 1 ? (
                <BlastGraph nodes={workload.nodes} edges={workload.edges} selectedId={selectedId} onSelect={setSelectedId} />
              ) : (
                <div className="flex h-full items-center justify-center px-8 text-base text-muted">Nothing beyond this workload is reachable.</div>
              )}
            </div>
          </div>
          <aside className="lg:sticky lg:top-36">
            {finding ? (
              <div>
                <h2 className="text-xl font-semibold">Selected step</h2>
                <p className="mt-4 text-lg">{plainFinding(finding, workload.id)}</p>
                <p className="mt-2 text-base tabular-nums" style={{ color: severityColor(finding.severity) }}>
                  {finding.impact} points
                </p>
                <p className="mt-4 text-base leading-7 text-muted">{finding.detail}</p>
                {finding.provenance ? (
                  <div className="mt-8 text-base leading-7">
                    <h3 className="text-lg font-semibold">Where this came from</h3>
                    <p className="mt-3">{formatDate(finding.provenance.date)}</p>
                    <p>{finding.provenance.author}</p>
                    <p className="text-muted">{finding.provenance.message}</p>
                    <p className="text-sm text-muted">
                      {finding.provenance.pr ? `Pull request ${finding.provenance.pr} · ` : ""}
                      {finding.provenance.file}
                      {finding.provenance.line ? `:${finding.provenance.line}` : ""} · {finding.provenance.short}
                    </p>
                  </div>
                ) : (
                  <p className="mt-8 text-base text-muted">Git history does not show who introduced this line.</p>
                )}
              </div>
            ) : (
              <p className="text-base text-muted">Nothing beyond this workload is reachable.</p>
            )}
          </aside>
        </div>
      ) : (
        <section className="mt-14 max-w-3xl">
          <h2 className="text-xl font-semibold">Changes that lower this score</h2>
          <p className="mt-3 text-base leading-7 text-muted">Each change is applied on its own and scored again. A change is listed only when it lowers the score by at least 5 points. The largest drop is first. Nothing here is written to the repository.</p>
          {workload.fixes.length === 0 ? (
            <p className="mt-8 text-base text-muted">No configuration change in this repository lowers this score.</p>
          ) : (
            <ul className="mt-8 space-y-8">
              {workload.fixes.map((fix) => (
                <li key={fix.id} className={fix.id === related?.id ? "border-l-2 border-foreground pl-5" : "border-l-2 border-transparent pl-5"}>
                  <div className="flex flex-wrap items-baseline justify-between gap-4">
                    <h3 className="text-lg font-medium">{fix.title}</h3>
                    <FixTip before={fix.scoreBefore} after={fix.scoreAfter} shrink={fix.shrink} factors={workload.factors} removed={fix.removes} afterFactors={fix.afterFactors}>
                      <button type="button" className={scoreTrigger("text-base tabular-nums text-ok")}>
                        Lowers the score by {fix.shrink}
                      </button>
                    </FixTip>
                  </div>
                  <p className="mt-2 text-base text-muted">
                    Score moves from {fix.scoreBefore} to {fix.scoreAfter}.
                  </p>
                  <Button type="button" variant="outline" className="mt-4" onClick={() => setPatch(fix.patch)}>
                    View the patch
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <Dialog open={patch !== null} onOpenChange={(open) => !open && setPatch(null)}>
        <DialogContent>
          <DialogTitle className="text-lg">Patch</DialogTitle>
          <DialogDescription className="text-base leading-7">Generated from the suggested change. Review it before applying. Nothing is written to the repository.</DialogDescription>
          <pre className="mt-4 max-h-80 overflow-auto border border-border bg-background p-4 font-mono text-sm leading-6 text-foreground">{patch}</pre>
          <div className="mt-4 flex justify-end">
            <Button variant="outline" onClick={() => setPatch(null)}>
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}
