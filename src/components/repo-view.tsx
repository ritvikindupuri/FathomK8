"use client";

import type { RepoScan } from "@/engine/types";
import { ImpactChart } from "@/components/impact-chart";
import { ScoreTip, scoreTrigger } from "@/components/score-tip";
import { delta, formatDate, severityColor } from "@/lib/format";
import Link from "next/link";

function plainNote(note: string): string {
  if (note.startsWith("Helm ")) return `Helm chart ${note.slice(5)}`;
  if (note.startsWith("Kustomize ")) return `Kustomize overlay ${note.slice(10)}`;
  if (note.startsWith("Manifest ")) return `manifest ${note.slice(9)}`;
  return note;
}

function changeSentence(change: number): string {
  if (change === 0) return "The score is unchanged since the previous commit.";
  if (change < 0) return `The score fell by ${Math.abs(change)} since the previous commit.`;
  return `The score rose by ${change} since the previous commit.`;
}

export function RepoView({ repo, base, section }: { repo: RepoScan; base: string; section: "overview" | "workloads" }) {
  const change = delta(repo.timeline);
  const short = repo.commit.slice(0, 7);
  const notes = repo.notes.filter((note) => !note.includes("failed")).map(plainNote);
  const worst = repo.workloads[0];
  const graphHref = worst
    ? `${base}/r/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/w/${encodeURIComponent(worst.namespace)}/${encodeURIComponent(worst.kind)}/${encodeURIComponent(worst.name)}`
    : "";

  return (
    <main className="mx-auto w-full max-w-6xl px-8 py-12">
      <p className="text-base text-muted">
        <Link href={base || "/"} className="hover:text-foreground hover:underline">
          All repositories
        </Link>
      </p>
      <div className="mt-6 flex flex-wrap items-end justify-between gap-8">
        <div className="max-w-2xl">
          <h1 className="text-3xl font-semibold tracking-tight">{repo.name}</h1>
          <p className="mt-4 text-base leading-7 text-muted">
            Branch {repo.branch || "unknown"} · commit {short || "uncommitted"} · scanned {formatDate(repo.scannedAt)}
            {notes.length ? ` · built from ${notes.join(", ")}` : ""}
          </p>
          {change !== null ? (
            <p className="mt-3 text-base leading-7" style={{ color: change > 0 ? "var(--high)" : change < 0 ? "var(--ok)" : "var(--muted)" }}>
              {changeSentence(change)}
            </p>
          ) : null}
          {repo.error ? <p className="mt-4 text-base text-critical">{repo.error}</p> : null}
          {repo.committedSecrets.length > 0 ? (
            <p className="mt-4 text-base text-critical">
              {repo.committedSecrets.length === 1
                ? `Secret ${repo.committedSecrets[0].name} is stored in git.`
                : `${repo.committedSecrets.length} secrets are stored in git.`}
            </p>
          ) : null}
        </div>
        <div className="text-right">
          <div className="text-sm text-muted">Blast radius</div>
          {repo.error ? (
            <div className="text-4xl font-semibold text-muted">–</div>
          ) : (
            <ScoreTip factors={worst?.factors || []} score={repo.score} note="This repository's score is its highest-risk workload, not an average.">
              <button type="button" className={scoreTrigger("text-4xl font-semibold tabular-nums")} style={{ color: severityColor(repo.severity) }}>
                {repo.score}
              </button>
            </ScoreTip>
          )}
        </div>
      </div>

      {section === "overview" ? (
        <section className="mt-14">
          <h2 className="text-xl font-semibold">Score over recent commits</h2>
          <p className="mt-3 max-w-2xl text-base leading-7 text-muted">Each point is one commit. Hover for the author and message. Click a point to keep that commit selected.</p>
          {repo.timeline.length > 0 ? (
            <div className="mt-6">
              <ImpactChart points={repo.timeline} />
            </div>
          ) : (
            <p className="mt-6 text-base text-muted">This repository has no commit history.</p>
          )}
          {worst ? (
            <p className="mt-8 text-base leading-7">
              Highest-risk workload:{" "}
              <Link href={graphHref} className="font-medium underline decoration-dotted underline-offset-4">
                {worst.namespace}/{worst.name}
              </Link>
              . Open it to see the attack graph.
            </p>
          ) : null}
        </section>
      ) : (
        <section className="mt-14">
          <h2 className="text-xl font-semibold">Workloads</h2>
          <p className="mt-3 max-w-2xl text-base leading-7 text-muted">Every workload found in the rendered configuration, highest blast radius first. Choose one to open its attack graph.</p>
          {repo.workloads.length === 0 ? (
            <p className="mt-6 text-base text-muted">This repository has no workloads in the rendered configuration.</p>
          ) : (
            <table className="mt-6 w-full border-collapse text-base">
              <thead>
                <tr className="border-b border-border text-left text-sm text-muted">
                  <th className="py-3 pr-4 font-medium">Workload</th>
                  <th className="hidden py-3 pr-4 font-medium sm:table-cell">Kind</th>
                  <th className="py-3 pr-4 font-medium">Blast radius</th>
                  <th className="hidden py-3 font-medium md:table-cell">What an attacker could reach</th>
                </tr>
              </thead>
              <tbody>
                {repo.workloads.map((workload) => (
                  <tr key={workload.id} className="border-b border-border">
                    <td className="py-4 pr-4">
                      <Link
                        href={`${base}/r/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/w/${encodeURIComponent(workload.namespace)}/${encodeURIComponent(workload.kind)}/${encodeURIComponent(workload.name)}`}
                        className="inline-flex min-h-11 items-center font-medium hover:underline"
                      >
                        {workload.name}
                      </Link>
                      <div className="text-sm text-muted">Namespace {workload.namespace}</div>
                    </td>
                    <td className="hidden py-4 pr-4 text-muted sm:table-cell">{workload.kind}</td>
                    <td className="py-4 pr-4">
                      <ScoreTip factors={workload.factors} score={workload.score}>
                        <button type="button" className={scoreTrigger("text-lg tabular-nums")} style={{ color: severityColor(workload.severity) }}>
                          {workload.score}
                        </button>
                      </ScoreTip>
                    </td>
                    <td className="hidden max-w-md py-4 text-muted md:table-cell">{workload.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </main>
  );
}
