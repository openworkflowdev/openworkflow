import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { ApiError } from "@/lib/api";
import { ErrorCode } from "@/lib/api";
import { Warning, Database, Gear } from "@phosphor-icons/react";

export interface ErrorDisplayProps {
  error: Error;
  onRetry?: () => void;
}

/**
 * Attempts to parse a structured ApiError from an error object
 * @param error - The error object to parse
 * @returns The parsed ApiError or null if not structured
 */
function parseApiError(error: Error): ApiError | null {
  try {
    // Try to parse the error message as JSON
    const parsed = JSON.parse(error.message);
    if (parsed && typeof parsed === "object" && "code" in parsed) {
      return parsed as ApiError;
    }
  } catch {
    // Not a structured error, return null
  }
  return null;
}

/**
 * Displays structured API errors with appropriate icons and styling
 * @param props - Component props
 * @param props.error - The error to display
 * @param props.onRetry - Optional retry callback function
 * @returns React component displaying the error
 */
export function ErrorDisplay({ error, onRetry }: ErrorDisplayProps) {
  const apiError = parseApiError(error);

  // Determine icon and colors based on error code
  let Icon = Warning;
  let iconColor = "text-red-500";
  let title = "Error";

  if (apiError) {
    switch (apiError.code) {
      case ErrorCode.DATABASE_CONNECTION_FAILED: {
        Icon = Database;
        title = "Database Connection Failed";
        break;
      }
      case ErrorCode.BACKEND_INITIALIZATION_FAILED: {
        Icon = Gear;
        iconColor = "text-amber-500";
        title = "Backend Initialization Failed";
        break;
      }
      case ErrorCode.NOT_FOUND: {
        Icon = Warning;
        iconColor = "text-amber-500";
        title = "Not Found";
        break;
      }
      case ErrorCode.INTERNAL_ERROR: {
        title = "Unexpected Error";
        break;
      }
    }
  }

  const message = apiError?.message ?? error.message ?? "An error occurred";
  const details = apiError?.details;

  return (
    <div className="flex h-screen items-center justify-center p-4">
      <Card className="border-border bg-card max-w-lg p-8">
        <div className="flex flex-col items-center text-center">
          <Icon className={`mb-4 size-16 ${iconColor}`} weight="duotone" />
          <h2 className="mb-2 text-2xl font-bold">{title}</h2>
          <p className="text-muted-foreground mb-6">{message}</p>

          {details !== undefined && details !== null && (
            <details className="mb-6 w-full">
              <summary className="text-muted-foreground mb-2 cursor-pointer text-sm">
                Technical details
              </summary>
              <Card className="bg-muted/50 border-border p-4 text-left">
                <pre className="text-foreground/80 overflow-x-auto font-mono text-xs break-words whitespace-pre-wrap">
                  {typeof details === "string"
                    ? details
                    : JSON.stringify(details, null, 2)}
                </pre>
              </Card>
            </details>
          )}

          {onRetry && (
            <Button onClick={onRetry} variant="default">
              Retry
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}
