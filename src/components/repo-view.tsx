"use client";

import type { RepoScan } from "@/engine/types";
import { ImpactChart } from "@/components/impact-chart";
import { ScoreTip, scoreTrigger } from "@/components/score-tip";
import { delta, formatDate, formatDelta, severityColor } from "@/lib/format";
import Link from "next/link";

export function RepoView({ repo, base }: { repo: RepoScan; base: string }) {
  const change = delta(repo.timeline);
  const short = repo.commit.slice(0, 7);

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-8">
      <Link href={base || "/"} className="text-xs text-muted hover:text-foreground">
        Repositories
      </Link>
      <div className="mt-4 flex items-end justify-between gap-6">
        <div>
          <h1 className="text-xl font-medium tracking-tight">{repo.name}</h1>
          <p className="mt-1 text-sm text-muted">
            {repo.branch} · {short || "uncommitted"} · {formatDate(repo.scannedAt)}
            {repo.notes.length ? ` · ${repo.notes.filter((note) => !note.includes("failed")).join(" · ")}` : ""}
          </p>
          {change !== null ? (
            <p className="mt-1 text-sm text-muted">
              <span style={{ color: change > 0 ? "var(--high)" : change < 0 ? "var(--ok)" : "var(--muted)" }}>{formatDelta(change)}</span>
              {" since the previous commit"}
            </p>
          ) : null}
          {repo.error ? <p className="mt-2 text-sm text-critical">{repo.error}</p> : null}
          {repo.committedSecrets.length > 0 ? (
            <p className="mt-2 text-sm text-critical">
              {repo.committedSecrets.length === 1
                ? `Secret ${repo.committedSecrets[0].name} is committed in git.`
                : `${repo.committedSecrets.length} secrets are committed in git.`}
            </p>
          ) : null}
        </div>
        <div className="text-right">
          <div className="text-xs text-muted">Impact</div>
          <ScoreTip factors={repo.workloads[0]?.factors || []} note="Repository score is the highest workload.">
            <button type="button" className={scoreTrigger("text-3xl font-medium tabular-nums")} style={{ color: severityColor(repo.severity) }}>
              {repo.score}
            </button>
          </ScoreTip>
        </div>
      </div>

      <h2 className="mt-10 text-xs font-medium uppercase tracking-wide text-muted">Impact by commit</h2>
      {repo.timeline.length > 0 ? <ImpactChart points={repo.timeline} /> : <p className="mt-3 text-sm text-muted">No commit history.</p>}

      <h2 className="mt-10 text-xs font-medium uppercase tracking-wide text-muted">Workloads</h2>
      {repo.workloads.length === 0 ? (
        <p className="mt-3 text-sm text-muted">No workloads in the rendered manifests.</p>
      ) : (
        <table className="mt-4 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted">
              <th className="py-2 font-medium">Workload</th>
              <th className="hidden py-2 font-medium sm:table-cell">Kind</th>
              <th className="py-2 font-medium">Impact</th>
              <th className="hidden py-2 font-medium md:table-cell">Reaches</th>
            </tr>
          </thead>
          <tbody>
            {repo.workloads.map((workload) => (
              <tr key={workload.id} className="border-b border-border hover:bg-surface">
                <td className="py-3 pr-4">
                  <Link href={`${base}/r/${repo.owner}/${repo.name}/w/${encodeURIComponent(workload.namespace)}/${workload.kind}/${encodeURIComponent(workload.name)}`} className="font-medium">
                    {workload.name}
                  </Link>
                  <div className="text-xs text-muted">{workload.namespace}</div>
                </td>
                <td className="hidden py-3 pr-4 text-muted sm:table-cell">{workload.kind}</td>
                <td className="py-3 pr-4 tabular-nums" style={{ color: severityColor(workload.severity) }}>
                  <ScoreTip factors={workload.factors}>
                    <button type="button" className={scoreTrigger("tabular-nums")} style={{ color: severityColor(workload.severity) }}>
                      {workload.score}
                    </button>
                  </ScoreTip>
                </td>
                <td className="hidden max-w-md truncate py-3 text-muted md:table-cell">{workload.summary}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
