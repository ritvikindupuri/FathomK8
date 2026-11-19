"use client";

import type { ScoreFactor } from "@/engine/types";
import { unionText } from "@/lib/format";
import { Tooltip } from "@/components/ui/tooltip";
import type { ReactNode } from "react";

function FactorList({ factors }: { factors: ScoreFactor[] }) {
  if (factors.length === 0) return <p className="text-muted">No reachable outcome.</p>;
  return (
    <ul>
      {factors.map((factor) => (
        <li key={factor.id} className="flex items-baseline justify-between gap-4">
          <span className="text-muted">{factor.label}</span>
          <span className="tabular-nums">{factor.points}</span>
        </li>
      ))}
    </ul>
  );
}

export function ScoreTip({
  factors,
  note,
  children,
}: {
  factors: ScoreFactor[];
  note?: string;
  children: ReactNode;
}) {
  return (
    <Tooltip
      wide
      content={
        <div>
          <FactorList factors={factors} />
          <p className="mt-2 text-muted">{unionText(factors.map((factor) => factor.points))}</p>
          {note ? <p className="mt-1 text-muted">{note}</p> : null}
          <p className="mt-2 border-t border-border pt-2 text-muted">100 = full cluster takeover.</p>
        </div>
      }
    >
      {children}
    </Tooltip>
  );
}

export function FixTip({
  before,
  after,
  shrink,
  factors,
  removed,
  afterFactors,
  children,
}: {
  before: number;
  after: number;
  shrink: number;
  factors: ScoreFactor[];
  removed: string[];
  afterFactors: ScoreFactor[];
  children: ReactNode;
}) {
  const dropped = new Set(removed);
  const taken = factors.filter((factor) => dropped.has(factor.id));
  return (
    <Tooltip
      wide
      content={
        <div>
          <p className="text-muted">Before {before}</p>
          <FactorList factors={factors} />
          <p className="mt-2 text-muted">Removed</p>
          <FactorList factors={taken} />
          <p className="mt-2 text-muted">After {after}</p>
          <FactorList factors={afterFactors} />
          <p className="mt-2 text-muted">
            {shrink} points leave the score. {unionText(afterFactors.map((factor) => factor.points))}
          </p>
          <p className="mt-2 border-t border-border pt-2 text-muted">100 = full cluster takeover.</p>
        </div>
      }
    >
      {children}
    </Tooltip>
  );
}

export function scoreTrigger(className: string) {
  return `cursor-help border-0 bg-transparent p-0 text-left font-[inherit] ${className}`;
}
