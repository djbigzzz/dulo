import * as React from "react";
import { cn } from "cn";

export interface EmptyStateProps extends React.ComponentProps<"div"> {
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  /** "card" (default) draws an ink-2 panel on a 1px rule; "plain" is for use inside drawers and cards. */
  variant?: "card" | "plain";
}

export function EmptyState({ icon, title, description, action, variant = "card", className, ...props }: EmptyStateProps) {
  return (
    <div
      role="status"
      className={cn(
        "flex flex-col items-center justify-center gap-2 text-center",
        variant === "card" ? "rounded-md border border-rule bg-card px-6 py-12 sm:py-14" : "px-2 py-8",
        className,
      )}
      {...props}
    >
      {icon ? (
        <div className="mb-2 flex size-11 items-center justify-center rounded-full border border-rule-2 bg-ink-3 text-foreground [&>svg]:size-5">
          {icon}
        </div>
      ) : null}
      <p className="font-display text-[1.75rem] leading-[1.05] font-normal tracking-[-0.01em] text-balance text-foreground">{title}</p>
      {description ? <p className="max-w-sm text-[0.9375rem] leading-relaxed text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
