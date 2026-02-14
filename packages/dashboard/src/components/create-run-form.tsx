import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createWorkflowRunServerFn } from "@/lib/api";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

interface CreateRunFormProps {
  onCancel?: () => void;
  onSuccess?: () => void;
}

function normalizeOptionalField(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toIsoDateTime(value: string, fieldName: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError(`${fieldName} must be a valid date and time`);
  }

  return parsed.toISOString();
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Unable to create workflow run";
}

export function CreateRunForm({ onCancel, onSuccess }: CreateRunFormProps) {
  const navigate = useNavigate();

  const [workflowName, setWorkflowName] = useState("");
  const [version, setVersion] = useState("");
  const [input, setInput] = useState("");
  const [availableAt, setAvailableAt] = useState("");
  const [deadlineAt, setDeadlineAt] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submitForm() {
    if (!workflowName.trim()) {
      setSubmitError("Workflow name is required");
      return;
    }

    const normalizedAvailableAt = normalizeOptionalField(availableAt);
    const normalizedDeadlineAt = normalizeOptionalField(deadlineAt);
    let availableAtIso: string | null = null;
    let deadlineAtIso: string | null = null;

    try {
      if (normalizedAvailableAt) {
        availableAtIso = toIsoDateTime(normalizedAvailableAt, "Schedule for");
      }
      if (normalizedDeadlineAt) {
        deadlineAtIso = toIsoDateTime(normalizedDeadlineAt, "Deadline");
      }
    } catch (error) {
      setSubmitError(getErrorMessage(error));
      return;
    }

    const normalizedInput = normalizeOptionalField(input);
    if (normalizedInput) {
      try {
        JSON.parse(normalizedInput);
      } catch {
        setInputError("Input must be valid JSON");
        return;
      }
    }

    setInputError(null);
    setSubmitError(null);
    setIsSubmitting(true);

    try {
      const run = await createWorkflowRunServerFn({
        data: {
          workflowName: workflowName.trim(),
          version: normalizeOptionalField(version),
          input: normalizedInput,
          availableAt: availableAtIso,
          deadlineAt: deadlineAtIso,
        },
      });

      onSuccess?.();
      await navigate({
        to: "/runs/$runId",
        params: { runId: run.id },
      });
    } catch (error) {
      setSubmitError(getErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleSubmit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitForm();
  }

  return (
    <form className="grid gap-5" onSubmit={handleSubmit}>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="create-run-workflow-name">
            Workflow Name *
          </FieldLabel>
          <Input
            id="create-run-workflow-name"
            name="workflowName"
            value={workflowName}
            onChange={(event) => {
              setWorkflowName(event.currentTarget.value);
            }}
            placeholder="e.g. hello-world"
            required
            disabled={isSubmitting}
          />
        </Field>
      </FieldGroup>

      <div className="space-y-4">
        <p className="text-muted-foreground text-xs tracking-wide uppercase">
          Optional
        </p>
        <FieldGroup>
          <Field data-invalid={!!inputError}>
            <FieldLabel htmlFor="create-run-input">Input (JSON)</FieldLabel>
            <Textarea
              id="create-run-input"
              name="input"
              value={input}
              onChange={(event) => {
                setInput(event.currentTarget.value);
                if (inputError) {
                  setInputError(null);
                }
              }}
              rows={6}
              placeholder='{"key":"value"}'
              disabled={isSubmitting}
            />
            <FieldDescription>
              JSON payload passed to the workflow function.
            </FieldDescription>
            <FieldError>{inputError}</FieldError>
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="create-run-available-at">
                Schedule For
              </FieldLabel>
              <Input
                id="create-run-available-at"
                name="availableAt"
                type="datetime-local"
                value={availableAt}
                onChange={(event) => {
                  setAvailableAt(event.currentTarget.value);
                }}
                disabled={isSubmitting}
              />
              <FieldDescription>
                Leave empty to start immediately.
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="create-run-deadline-at">Deadline</FieldLabel>
              <Input
                id="create-run-deadline-at"
                name="deadlineAt"
                type="datetime-local"
                value={deadlineAt}
                onChange={(event) => {
                  setDeadlineAt(event.currentTarget.value);
                }}
                disabled={isSubmitting}
              />
              <FieldDescription>Leave empty for no deadline.</FieldDescription>
            </Field>
          </div>

          <Field className="sm:max-w-sm">
            <FieldLabel htmlFor="create-run-version">Version</FieldLabel>
            <Input
              id="create-run-version"
              name="version"
              value={version}
              onChange={(event) => {
                setVersion(event.currentTarget.value);
              }}
              placeholder="e.g. v2"
              disabled={isSubmitting}
            />
          </Field>
        </FieldGroup>
      </div>

      <FieldError>{submitError}</FieldError>

      <div className="flex items-center justify-end gap-2">
        <Button
          variant="outline"
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Creating..." : "Create Run"}
        </Button>
      </div>
    </form>
  );
}
