import { ScheduleEditor } from "./schedule-editor";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { Button } from "./ui/button";
import {
  deleteWorkflowScheduleServerFn,
  setWorkflowSchedulePausedServerFn,
} from "@/lib/api";
import { PauseIcon, PlayIcon, TrashIcon } from "@phosphor-icons/react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import type { WorkflowSchedule } from "openworkflow";
import { useState } from "react";

// oxlint-disable-next-line max-lines-per-function -- Keep the confirmation and mutation state together, as in RunAction.
export function ScheduleActions({ schedule }: { schedule: WorkflowSchedule }) {
  const router = useRouter();
  const navigate = useNavigate();
  const [deleting, setDeleting] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const paused = schedule.nextRunAt === null;
  const toggleLabel = paused ? "Resume Schedule" : "Pause Schedule";

  async function performAction(action: "toggle" | "delete") {
    setPending(true);
    setError(null);
    try {
      const data = { workflowScheduleId: schedule.id };
      if (action === "delete") {
        await deleteWorkflowScheduleServerFn({ data });
        await navigate({ to: "/schedules" });
      } else {
        await setWorkflowSchedulePausedServerFn({
          data: { ...data, paused: !paused },
        });
      }
      await router.invalidate();
      setDeleting(false);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to update schedule",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => {
            void performAction("toggle");
          }}
        >
          {paused ? <PlayIcon /> : <PauseIcon />}
          {pending && !deleting ? "Updating..." : toggleLabel}
        </Button>
        <ScheduleEditor schedule={schedule} disabled={pending} />
        <AlertDialog
          open={deleting}
          onOpenChange={(next) => {
            if (!pending) {
              setDeleting(next);
              setError(null);
            }
          }}
        >
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => {
              setDeleting(true);
              setError(null);
            }}
          >
            <TrashIcon />
            Delete
          </Button>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete schedule?</AlertDialogTitle>
              <AlertDialogDescription>
                Delete “{schedule.id}” to stop future scheduled runs. Existing
                runs are kept. If you define this schedule in code, remove it
                there too so the next worker startup doesn't recreate it.
              </AlertDialogDescription>
            </AlertDialogHeader>
            {error && (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>
                Keep Schedule
              </AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={pending}
                onClick={(event) => {
                  event.preventDefault();
                  void performAction("delete");
                }}
              >
                {pending ? "Deleting..." : "Delete Schedule"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      {error && !deleting && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
