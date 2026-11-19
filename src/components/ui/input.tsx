import * as React from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "flex h-10 w-full rounded-md border border-border bg-background px-3 text-base text-foreground outline-none focus-visible:ring-1 focus-visible:ring-accent",
        className,
      )}
      {...props}
    />
  );
}
