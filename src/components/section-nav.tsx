"use client";

import Link from "next/link";

export type SectionId = "overview" | "workloads" | "graph" | "fixes";

export function SectionNav({
  current,
  overviewHref,
  workloadsHref,
  graphHref,
  fixesHref,
}: {
  current: SectionId;
  overviewHref: string;
  workloadsHref?: string;
  graphHref?: string;
  fixesHref?: string;
}) {
  const items: { id: SectionId; label: string; href?: string }[] = [
    { id: "overview", label: "Overview", href: overviewHref },
    { id: "workloads", label: "Workloads", href: workloadsHref },
    { id: "graph", label: "Attack graph", href: graphHref },
    { id: "fixes", label: "Fixes", href: fixesHref },
  ];

  return (
    <nav aria-label="Sections">
      <ul className="flex flex-wrap gap-x-8">
        {items.map((item) => {
          const active = item.id === current;
          const className = active
            ? "inline-flex min-h-12 items-center border-b-2 border-foreground text-base text-foreground"
            : "inline-flex min-h-12 items-center border-b-2 border-transparent text-base text-muted hover:text-foreground";
          return (
            <li key={item.id}>
              {item.href ? (
                <Link href={item.href} aria-current={active ? "page" : undefined} className={className}>
                  {item.label}
                </Link>
              ) : (
                <span title="Choose a repository first." aria-disabled="true" className="inline-flex min-h-12 items-center border-b-2 border-transparent text-base text-muted/60">
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
