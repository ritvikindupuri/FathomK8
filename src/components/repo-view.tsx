"use client";

import type { RepoScan } from "@/engine/types";
import { ImpactChart } from "@/components/impact-chart";
import { ScoreTip, scoreTrigger } from "@/components/score-tip";
import { delta, formatDelta, formatScanDate, severityColor } from "@/lib/format";
import Link from "next/link";

function scannedFile(note: string): string | null {
  if (note.toLowerCase().includes("failed")) return null;
  if (note.startsWith("Manifest ")) return note.slice("Manifest ".length);
  if (note.startsWith("Helm ")) {
    const rest = note.slice("Helm ".length).replace(/\/$/, "");
    if (!rest || rest === "." || !rest.includes("/")) return "Chart.yaml";
    return `${rest}/Chart.yaml`;
  }
  if (note.startsWith("Kustomize ")) {
    const rest = note.slice("Kustomize ".length).replace(/\/$/, "");
    if (!rest || rest === ".") return "kustomization.yaml";
    return `${rest}/kustomization.yaml`;
  }
  return note;
}

export function RepoView({ repo, base, section }: { repo: RepoScan; base: string; section: "overview" | "workloads" }) {
  const change = delta(repo.timeline);
  const short = repo.commit.slice(0, 7);
  const files = [...new Set(repo.notes.map(scannedFile).filter((file): file is string => Boolean(file)))];
  const commitUrl = /^[0-9a-f]{7,}$/i.test(repo.commit) && repo.htmlUrl ? `${repo.htmlUrl.replace(/\/$/, "")}/commit/${repo.commit}` : "";
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
          <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-base leading-7 text-muted">
            <span>
              {repo.branch || "unknown"}
              {" · "}
              {commitUrl ? (
                <a href={commitUrl} className="underline decoration-dotted underline-offset-4 hover:text-foreground">
                  {short}
                </a>
              ) : (
                short || "uncommitted"
              )}
              {" · Scanned "}
              {formatScanDate(repo.scannedAt)}
            </span>
            {change !== null && change !== 0 ? (
              <span className="inline-flex items-center rounded border border-border px-2 py-0.5 text-sm" style={{ color: change > 0 ? "var(--high)" : "var(--ok)" }}>
                {change > 0 ? "▲" : "▼"} {formatDelta(change)} since last commit
              </span>
            ) : null}
          </p>
          {files.length > 0 ? (
            <details className="mt-3 text-sm text-muted">
              <summary className="cursor-pointer">Files scanned ({files.length})</summary>
              <ul className="mt-2 space-y-1">
                {files.map((file) => (
                  <li key={file}>{file}</li>
                ))}
              </ul>
            </details>
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

      {section === "overview" && repo.cuts && repo.cuts.length > 0 ? (
        <section className="mt-10">
          <h2 className="text-xl font-semibold">Changes that break the most paths</h2>
          <ul className="mt-4 max-w-3xl space-y-3 text-base leading-7">
            {repo.cuts.slice(0, 3).map((cut) => (
              <li key={cut.title}>
                <span className="font-medium">{cut.title}</span>
                <span className="text-muted">
                  {" "}
                  — breaks {cut.paths} path{cut.paths === 1 ? "" : "s"}. {cut.detail}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {section === "overview" && repo.standing && repo.standing.length > 0 ? (
        <section className="mt-10">
          <h2 className="text-xl font-semibold">Standing exposures</h2>
          <ul className="mt-4 max-w-3xl space-y-3 text-base leading-7 text-muted">
            {repo.standing.slice(0, 3).map((note) => (
              <li key={note.title}>
                <span className="font-medium text-foreground">{note.title}.</span> {note.detail}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {repo.caveat ? <p className="mt-6 max-w-3xl text-base leading-7 text-muted">{repo.caveat}</p> : null}

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
