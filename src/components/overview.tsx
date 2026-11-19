"use client";

import type { RepoScan } from "@/engine/types";
import { ScoreTip, scoreTrigger } from "@/components/score-tip";
import { delta, formatDelta, severityColor } from "@/lib/format";
import Link from "next/link";

export function Overview({ repos, base }: { repos: RepoScan[]; base: string }) {
  const ranked = [...repos].sort((a, b) => b.score - a.score);
  const highestRepo = ranked[0];
  const highest = highestRepo?.score ?? 0;

  if (ranked.length === 0) {
    return (
      <main className="mx-auto w-full max-w-6xl px-8 py-16">
        <h1 className="text-3xl font-semibold tracking-tight">Repositories</h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-muted">No repositories yet. Paste a GitHub URL in the bar above and press Scan.</p>
        <p className="mt-3 max-w-2xl text-base leading-7 text-muted">Fathom clones that repository, reads its git history, and scores the Kubernetes configuration it finds.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-8 py-12">
      <div className="flex flex-wrap items-end justify-between gap-8">
        <div className="max-w-2xl">
          <h1 className="text-3xl font-semibold tracking-tight">Repositories</h1>
          <p className="mt-4 text-base leading-7 text-muted">
            Each number is a blast radius from 0 to 100: how much of the cluster an attacker could reach if one workload were compromised. Hover a number to read the reasons.
          </p>
        </div>
        <div className="text-right">
          <div className="text-sm text-muted">Highest blast radius</div>
          <ScoreTip factors={highestRepo.workloads[0]?.factors || []} score={highest} note="This is the highest-risk workload in the highest-risk repository, not an average.">
            <button type="button" className={scoreTrigger("text-4xl font-semibold tabular-nums")} style={{ color: severityColor(highestRepo.severity) }}>
              {highestRepo.error ? "–" : highest}
            </button>
          </ScoreTip>
        </div>
      </div>

      <section className="mt-16">
        <h2 className="text-xl font-semibold">Scanned repositories</h2>
        <p className="mt-3 max-w-2xl text-base leading-7 text-muted">Repositories you pasted above. New commits on the tracked branch are scanned again.</p>
        <RepoTable repos={ranked} base={base} />
      </section>
    </main>
  );
}

function RepoTable({ repos, base }: { repos: RepoScan[]; base: string }) {
  return (
    <table className="mt-6 w-full border-collapse text-base">
      <thead>
        <tr className="border-b border-border text-left text-sm text-muted">
          <th className="py-3 pr-4 font-medium">Repository</th>
          <th className="py-3 pr-4 font-medium">Blast radius</th>
          <th className="hidden py-3 pr-4 font-medium sm:table-cell">Change</th>
          <th className="hidden py-3 font-medium md:table-cell">Highest-risk workload</th>
        </tr>
      </thead>
      <tbody>
        {repos.map((repo) => {
          const change = delta(repo.timeline);
          const worst = repo.workloads[0];
          return (
            <tr key={repo.id} className="border-b border-border">
              <td className="py-4 pr-4">
                <Link href={`${base}/r/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`} className="inline-flex min-h-11 items-center font-medium hover:underline">
                  {repo.name}
                </Link>
                {repo.error ? <div className="mt-1 max-w-md text-sm text-critical">{repo.error}</div> : null}
              </td>
              <td className="py-4 pr-4">
                <div className="text-lg tabular-nums" style={{ color: severityColor(repo.severity) }}>
                  {repo.error ? (
                    "–"
                  ) : (
                    <ScoreTip factors={worst?.factors || []} score={repo.score} note="This repository's score is its highest-risk workload, not an average.">
                      <button type="button" className={scoreTrigger("text-lg tabular-nums")} style={{ color: severityColor(repo.severity) }}>
                        {repo.score}
                      </button>
                    </ScoreTip>
                  )}
                </div>
              </td>
              <td className="hidden py-4 pr-4 text-base tabular-nums sm:table-cell" style={{ color: change === null ? "var(--muted)" : change > 0 ? "var(--high)" : change < 0 ? "var(--ok)" : "var(--muted)" }}>
                {change === null ? "–" : formatDelta(change)}
              </td>
              <td className="hidden py-4 text-muted md:table-cell">{worst ? `${worst.namespace}/${worst.name}` : "–"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
