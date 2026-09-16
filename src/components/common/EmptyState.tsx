import * as React from "react";
import { cn } from "cn";

export interface EmptyStateProps extends React.ComponentProps<"div"> {
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  /** "card" (default) draws a glass panel; "plain" is for use inside drawers and cards. */
  variant?: "card" | "plain";
}

export function EmptyState({ icon, title, description, action, variant = "card", className, ...props }: EmptyStateProps) {
  return (
    <div
      role="status"
      className={cn(
        "flex flex-col items-center justify-center gap-2 text-center",
        variant === "card" ? "rounded-2xl border border-white/[0.07] bg-card px-6 py-12 sm:py-14" : "px-2 py-8",
        className,
      )}
      {...props}
    >
      {icon ? (
        <div className="mb-2 flex size-12 items-center justify-center rounded-2xl border border-gold/25 bg-gold/[0.06] text-gold shadow-[inset_0_1px_0_rgb(255_245_230/0.08),0_0_24px_-8px_rgb(216_180_106/0.45)] [&>svg]:size-5">
          {icon}
        </div>
      ) : null}
      <p className="font-display text-2xl leading-tight font-normal tracking-[-0.01em] text-foreground">{title}</p>
      {description ? <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
