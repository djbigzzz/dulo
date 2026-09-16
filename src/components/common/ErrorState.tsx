import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, type EmptyStateProps } from "@/components/common/EmptyState";

export interface ErrorStateProps extends Omit<EmptyStateProps, "title" | "icon" | "action" | "description"> {
  /** What failed, in the page's words. Default "Couldn't load this page". */
  title?: string;
  /** The error message from the API client. */
  message?: string | null;
  onRetry?: () => void;
  retryLabel?: string;
}

/** Failed-request state with a retry button. Pairs with useApiQuery. */
export function ErrorState({ title = "Couldn't load this page", message, onRetry, retryLabel = "Try again", ...props }: ErrorStateProps) {
  return (
    <EmptyState
      icon={<AlertTriangle aria-hidden />}
      title={title}
      description={message || "The request did not go through. Check your connection and try again."}
      action={
        onRetry ? (
          <Button variant="outline" size="sm" className="h-10 sm:h-8" onClick={onRetry}>
            <RefreshCw data-icon="inline-start" aria-hidden />
            {retryLabel}
          </Button>
        ) : null
      }
      {...props}
    />
  );
}

export default ErrorState;
