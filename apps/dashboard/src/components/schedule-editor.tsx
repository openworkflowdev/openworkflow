import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";
import { MonacoJsonEditor } from "./ui/monaco-json-editor";
import { saveWorkflowScheduleServerFn } from "@/lib/api";
import { PencilSimpleIcon, PlusIcon } from "@phosphor-icons/react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import type { WorkflowSchedule } from "openworkflow";
import { useState } from "react";

// oxlint-disable-next-line max-lines-per-function -- Keep the dialog, form state, and submit lifecycle together, as in CreateRunForm.
export function ScheduleEditor({
  schedule,
  disabled = false,
}: {
  schedule?: WorkflowSchedule;
  disabled?: boolean;
}) {
  const navigate = useNavigate();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const submitLabel = schedule ? "Save Changes" : "Create Schedule";

  function changeOpen(next: boolean) {
    if (pending) return;
    if (next && !open) {
      setError(null);
      setInput(
        schedule?.input === undefined || schedule.input === null
          ? ""
          : JSON.stringify(schedule.input, null, 2),
      );
    }
    setOpen(next);
  }

  async function save(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const workflowName = readFormField(form, "workflowName").trim();
    setPending(true);
    setError(null);
    try {
      const saved = await saveWorkflowScheduleServerFn({
        data: {
          id:
            schedule?.id ?? (readFormField(form, "id").trim() || workflowName),
          workflowName,
          cron: readFormField(form, "cron"),
          timezone: readFormField(form, "timezone"),
          input,
          mode: schedule ? "edit" : "create",
        },
      });
      await router.invalidate();
      await navigate({
        to: "/schedules/$scheduleId",
        params: { scheduleId: saved.id },
      });
      setOpen(false);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to save schedule",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <Button
        type="button"
        disabled={disabled}
        variant={schedule ? "outline" : "default"}
        onClick={() => {
          changeOpen(true);
        }}
      >
        {schedule ? <PencilSimpleIcon /> : <PlusIcon />}
        {schedule ? "Edit Schedule" : "New Schedule"}
      </Button>
      <DialogContent size="lg" className="gap-0 p-0">
        <DialogHeader className="border-border border-b px-5 py-4">
          <DialogTitle>
            {schedule ? "Edit Schedule" : "Create Schedule"}
          </DialogTitle>
          <DialogDescription>
            {schedule
              ? "Changes apply to future runs. Paused schedules stay paused."
              : "Run a workflow automatically on a recurring schedule."}
          </DialogDescription>
        </DialogHeader>
        {open && (
          <form
            onSubmit={(event) => {
              void save(event);
            }}
            className="grid gap-5 p-5"
          >
            <FieldGroup>
              <ScheduleFields schedule={schedule} pending={pending} />
              <Field>
                <FieldLabel htmlFor="schedule-input">Input (JSON)</FieldLabel>
                <MonacoJsonEditor
                  id="schedule-input"
                  value={input}
                  onChange={setInput}
                  readOnly={pending}
                  minLines={4}
                  maxLines={10}
                />
                <FieldDescription>
                  Each scheduled run uses this input.
                </FieldDescription>
              </Field>
            </FieldGroup>
            {error && (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => {
                  setOpen(false);
                }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving..." : submitLabel}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ScheduleFields({
  schedule,
  pending,
}: {
  schedule: WorkflowSchedule | undefined;
  pending: boolean;
}) {
  const fields = [
    {
      name: "workflowName",
      label: "Workflow Name *",
      value: schedule?.workflowName ?? "",
      placeholder: "e.g. daily-report",
      description: "Use a workflow registered with a worker.",
    },
    {
      name: "id",
      label: "Schedule ID",
      value: schedule?.id ?? "",
      placeholder: "Defaults to workflow name",
      description: schedule
        ? "The ID cannot be changed."
        : "Use a unique ID for each schedule of the same workflow.",
    },
    {
      name: "cron",
      label: "Cron Expression *",
      value: schedule?.cron ?? "0 9 * * 1-5",
      placeholder: "0 9 * * 1-5",
      description:
        "Minute, hour, day, month, weekday. Add seconds as an optional sixth field at the beginning.",
    },
    {
      name: "timezone",
      label: "Time Zone *",
      value: schedule?.timezone ?? "UTC",
      placeholder: "America/Chicago",
      description: "An IANA time zone, such as America/Chicago or UTC.",
    },
  ];
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      {fields.map((field) => (
        <Field key={field.name}>
          <FieldLabel htmlFor={`schedule-${field.name}`}>
            {field.label}
          </FieldLabel>
          <Input
            id={`schedule-${field.name}`}
            name={field.name}
            defaultValue={field.value}
            placeholder={field.placeholder}
            required={field.name !== "id"}
            readOnly={field.name === "id" && !!schedule}
            disabled={pending}
          />
          <FieldDescription>{field.description}</FieldDescription>
        </Field>
      ))}
    </div>
  );
}

function readFormField(form: FormData, name: string): string {
  // safety: ScheduleFields renders named text inputs only, with no file inputs.
  return (form.get(name) as string | null) ?? "";
}
