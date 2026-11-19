"use client";

import type { ScoreFactor } from "@/engine/types";
import { BAND_LEGEND, bandName, combineSentence, factorSentence, scoreMeaning } from "@/lib/score-copy";
import { Tooltip } from "@/components/ui/tooltip";
import type { ReactNode } from "react";

function ReasonList({ factors }: { factors: ScoreFactor[] }) {
  if (factors.length === 0) return <p>Nothing beyond this workload is reachable.</p>;
  return (
    <ul className="mt-2 space-y-1.5">
      {factors.map((factor) => (
        <li key={factor.id}>{factorSentence(factor)}</li>
      ))}
    </ul>
  );
}

export function ScoreTip({
  factors,
  score,
  note,
  children,
}: {
  factors: ScoreFactor[];
  score: number;
  note?: string;
  children: ReactNode;
}) {
  return (
    <Tooltip
      wide
      content={
        <div className="space-y-3 text-sm leading-6">
          <p>{scoreMeaning(score)}</p>
          <p>
            This score is {bandName(score).toLowerCase()}. {BAND_LEGEND}
          </p>
          <div>
            <p className="font-medium text-foreground">Why this score</p>
            <ReasonList factors={factors} />
          </div>
          <p>{combineSentence(factors)}</p>
          {note ? <p>{note}</p> : null}
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
        <div className="space-y-3 text-sm leading-6">
          <p>
            This change lowers the blast radius from {before} to {after}, by {shrink} points.
          </p>
          <div>
            <p className="font-medium text-foreground">It removes</p>
            <ReasonList factors={taken} />
          </div>
          <div>
            <p className="font-medium text-foreground">What would still be reachable</p>
            <ReasonList factors={afterFactors} />
          </div>
          <p>{combineSentence(afterFactors)}</p>
        </div>
      }
    >
      {children}
    </Tooltip>
  );
}

export function scoreTrigger(className: string) {
  return `cursor-help rounded-sm border-0 bg-transparent p-0 text-left font-[inherit] underline decoration-dotted decoration-current/50 underline-offset-4 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent ${className}`;
}
