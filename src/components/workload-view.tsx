"use client";

import type { RepoScan, WorkloadView as Workload } from "@/engine/types";
import { BlastGraph } from "@/components/blast-graph";
import { FixTip, ScoreTip, scoreTrigger } from "@/components/score-tip";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { formatDate, severityColor } from "@/lib/format";
import Link from "next/link";
import { useMemo, useState } from "react";

export function WorkloadView({ repo, workload, base }: { repo: RepoScan; workload: Workload; base: string }) {
  const [selectedId, setSelectedId] = useState<string | null>(workload.findings[0]?.id || null);
  const [patch, setPatch] = useState<string | null>(null);
  const finding = workload.findings.find((item) => item.id === selectedId) || workload.findings[0];
  const assetId = finding ? finding.id.slice(workload.id.length + 1) : "";
  const related = useMemo(
    () => workload.fixes.find((fix) => fix.removes.includes(assetId)) || workload.fixes[0],
    [workload.fixes, assetId],
  );

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-8">
      <Link href={`${base}/r/${repo.owner}/${repo.name}`} className="text-xs text-muted hover:text-foreground">
        {repo.name}
      </Link>
      <div className="mt-4 flex items-end justify-between gap-6">
        <div>
          <h1 className="text-xl font-medium tracking-tight">{workload.name}</h1>
          <p className="mt-1 text-sm text-muted">
            {workload.kind} · {workload.namespace} · {workload.serviceAccount}
            {workload.image ? ` · ${workload.image}` : ""}
          </p>
          <p className="mt-3 max-w-2xl text-sm">{workload.summary}</p>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted">Impact</div>
          <ScoreTip factors={workload.factors}>
            <button type="button" data-testid="impact-score" className={scoreTrigger("text-3xl font-medium tabular-nums")} style={{ color: severityColor(workload.severity) }}>
              {workload.score}
            </button>
          </ScoreTip>
        </div>
      </div>

      <div className="mt-8 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="h-[420px] rounded-md border border-border bg-surface lg:h-[560px]">
          {workload.nodes.length > 1 ? (
            <BlastGraph nodes={workload.nodes} edges={workload.edges} selectedId={selectedId} onSelect={setSelectedId} />
          ) : (
            <div className="flex h-full items-center justify-center px-6 text-sm text-muted">No reachable assets from this workload.</div>
          )}
        </div>

        <aside className="lg:sticky lg:top-16">
          {finding ? (
            <div>
              <div className="text-xs uppercase tracking-wide text-muted">Exposure</div>
              <h2 className="mt-2 text-sm font-medium">{finding.title}</h2>
              <div className="mt-1 text-sm tabular-nums" style={{ color: severityColor(finding.severity) }}>
                {finding.impact}
              </div>
              <p className="mt-3 text-sm leading-6 text-muted">{finding.detail}</p>
              {finding.provenance ? (
                <div className="mt-4 text-sm leading-6">
                  <div className="text-xs uppercase tracking-wide text-muted">Introduced</div>
                  <div className="mt-1">{formatDate(finding.provenance.date)}</div>
                  <div>{finding.provenance.author}</div>
                  <div className="text-muted">{finding.provenance.message}</div>
                  <div className="text-xs text-muted">
                    {finding.provenance.pr ? `PR ${finding.provenance.pr} · ` : ""}
                    {finding.provenance.file}
                    {finding.provenance.line ? `:${finding.provenance.line}` : ""} · {finding.provenance.short}
                  </div>
                </div>
              ) : (
                <p className="mt-4 text-sm text-muted">No git provenance for this line.</p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted">Nothing reachable beyond this workload.</p>
          )}

          <Separator className="my-5" />
          <div className="text-xs uppercase tracking-wide text-muted">Fixes by impact removed</div>
          {workload.fixes.length === 0 ? (
            <p className="mt-3 text-sm text-muted">No config change reduces this score.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {workload.fixes.map((fix) => (
                <li key={fix.id} className={fix.id === related?.id ? "border-l border-accent pl-3" : "pl-3"}>
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="text-sm">{fix.title}</div>
                    <FixTip before={fix.scoreBefore} after={fix.scoreAfter} shrink={fix.shrink} factors={workload.factors} removed={fix.removes} afterFactors={fix.afterFactors}>
                      <button type="button" className={scoreTrigger("text-sm tabular-nums text-ok")}>
                        −{fix.shrink}
                      </button>
                    </FixTip>
                  </div>
                  <div className="mt-1 text-xs text-muted">
                    {fix.scoreBefore} → {fix.scoreAfter}
                  </div>
                  <button type="button" className="mt-1 text-xs text-accent" onClick={() => setPatch(fix.patch)}>
                    View patch
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>

      <Dialog open={patch !== null} onOpenChange={(open) => !open && setPatch(null)}>
        <DialogContent>
          <DialogTitle>Patch</DialogTitle>
          <DialogDescription>Generated from the simulated change. Review it before applying.</DialogDescription>
          <pre className="mt-4 max-h-80 overflow-auto rounded-md border border-border bg-background p-3 font-mono text-xs leading-5 text-foreground">{patch}</pre>
          <div className="mt-4 flex justify-end">
            <Button variant="outline" size="sm" onClick={() => setPatch(null)}>
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}
