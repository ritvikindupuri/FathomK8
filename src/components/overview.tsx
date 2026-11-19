"use client";

import type { RepoScan } from "@/engine/types";
import { ScoreTip, scoreTrigger } from "@/components/score-tip";
import { delta, formatDelta, severityColor } from "@/lib/format";
import Link from "next/link";

export function Overview({
  repos,
  githubDetail,
  base,
}: {
  repos: RepoScan[];
  githubDetail: string;
  base: string;
}) {
  const github = repos.filter((repo) => repo.source === "github").sort((a, b) => b.score - a.score);
  const demos = repos.filter((repo) => repo.source === "demo").sort((a, b) => b.score - a.score);
  const highest = repos.reduce((max, repo) => Math.max(max, repo.score), 0);
  const highestSeverity = repos.find((repo) => repo.score === highest)?.severity || "low";

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="flex items-end justify-between gap-8">
        <div>
          <h1 className="text-xl font-medium tracking-tight">Repositories</h1>
          <p className="mt-1 max-w-xl text-sm text-muted">Reachable impact if a workload is compromised. Scored from rendered manifests, not from a count of misconfigurations.</p>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted">Highest</div>
          {repos.length ? (
            <ScoreTip factors={repos.find((repo) => repo.score === highest)?.workloads[0]?.factors || []} note="Repository score is the highest workload.">
              <button type="button" className={scoreTrigger("text-3xl font-medium tabular-nums")} style={{ color: severityColor(highestSeverity) }}>
                {highest}
              </button>
            </ScoreTip>
          ) : (
            <div className="text-3xl font-medium text-muted">–</div>
          )}
        </div>
      </div>

      <section className="mt-12">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted">GitHub</h2>
        <p className="mt-2 text-sm text-muted">{githubDetail}</p>
        {github.length > 0 ? <RepoTable repos={github} base={base} /> : null}
      </section>

      <section className="mt-12">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted">Demo corpus</h2>
        <p className="mt-2 text-sm text-muted">A Helm chart and a Kustomize app with history. No credentials.</p>
        <RepoTable repos={demos} base={base} />
      </section>
    </main>
  );
}

function RepoTable({ repos, base }: { repos: RepoScan[]; base: string }) {
  return (
    <table className="mt-4 w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-border text-left text-xs text-muted">
          <th className="py-2 font-medium">Repository</th>
          <th className="py-2 font-medium">Impact</th>
          <th className="hidden py-2 font-medium sm:table-cell">Change</th>
          <th className="hidden py-2 font-medium md:table-cell">Worst workload</th>
        </tr>
      </thead>
      <tbody>
        {repos.map((repo) => {
          const change = delta(repo.timeline);
          const worst = repo.workloads[0];
          return (
            <tr key={repo.id} className="border-b border-border hover:bg-surface">
              <td className="py-3 pr-4">
                <Link href={`${base}/r/${repo.owner}/${repo.name}`} className="font-medium">
                  {repo.name}
                </Link>
                {repo.error ? <div className="mt-1 text-xs text-critical">{repo.error}</div> : null}
              </td>
              <td className="py-3 pr-4">
                <div className="tabular-nums" style={{ color: severityColor(repo.severity) }}>
                  {repo.error ? (
                    "–"
                  ) : (
                    <ScoreTip factors={worst?.factors || []} note="Repository score is the highest workload.">
                      <button type="button" className={scoreTrigger("tabular-nums")} style={{ color: severityColor(repo.severity) }}>
                        {repo.score}
                      </button>
                    </ScoreTip>
                  )}
                </div>
                <div className="mt-1 h-0.5 w-16 bg-border">
                  <div className="h-0.5" style={{ width: `${repo.score}%`, background: severityColor(repo.severity) }} />
                </div>
              </td>
              <td className="hidden py-3 pr-4 tabular-nums sm:table-cell" style={{ color: change === null ? "var(--muted)" : change > 0 ? "var(--high)" : change < 0 ? "var(--ok)" : "var(--muted)" }}>
                {change === null ? "–" : formatDelta(change)}
              </td>
              <td className="hidden py-3 text-muted md:table-cell">{worst ? `${worst.namespace}/${worst.name}` : "–"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
