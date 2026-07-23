import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { ReactNode } from "react";
import { useState } from "react";

type ButtonVariant = React.ComponentProps<typeof Button>["variant"];

interface RunActionDialogProps {
  triggerLabel: string;
  triggerVariant?: ButtonVariant;
  title: string;
  description: ReactNode;
  cancelLabel: string;
  confirmLabel: string;
  pendingLabel: string;
  confirmVariant?: ButtonVariant;
  fallbackErrorMessage: string;
  action: () => Promise<unknown>;
  onDone?: (() => Promise<void>) | (() => void);
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}

// Confirmation dialog shared by the run action buttons (cancel, resume).
export function RunActionDialog({
  triggerLabel,
  triggerVariant = "default",
  title,
  description,
  cancelLabel,
  confirmLabel,
  pendingLabel,
  confirmVariant,
  fallbackErrorMessage,
  action,
  onDone,
}: RunActionDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runAction() {
    setIsPending(true);
    setError(null);

    try {
      await action();
      await onDone?.();
      setIsOpen(false);
    } catch (caughtError) {
      setError(getErrorMessage(caughtError, fallbackErrorMessage));
    } finally {
      setIsPending(false);
    }
  }

  return (
    <AlertDialog
      open={isOpen}
      onOpenChange={(nextOpen) => {
        setIsOpen(nextOpen);
        if (!nextOpen) {
          setError(null);
        }
      }}
    >
      <Button
        type="button"
        variant={triggerVariant}
        onClick={() => {
          setIsOpen(true);
        }}
        disabled={isPending}
      >
        {triggerLabel}
      </Button>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>

        {error && <p className="text-destructive text-xs">{error}</p>}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>
            {cancelLabel}
          </AlertDialogCancel>
          <AlertDialogAction
            variant={confirmVariant}
            onClick={() => {
              void runAction();
            }}
            disabled={isPending}
          >
            {isPending ? pendingLabel : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
