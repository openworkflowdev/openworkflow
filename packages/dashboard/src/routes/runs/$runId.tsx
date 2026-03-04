import { AppLayout } from "@/components/app-layout";
import { RunCancelAction } from "@/components/run-cancel-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  getStepAttemptServerFn,
  getWorkflowRunServerFn,
  listStepAttemptsServerFn,
} from "@/lib/api";
import {
  STEP_STATUS_CONFIG,
  TERMINAL_RUN_STATUSES,
  getStatusColor,
  getStatusBadgeClass,
} from "@/lib/status";
import { usePolling } from "@/lib/use-polling";
import { cn } from "@/lib/utils";
import { computeDuration, formatRelativeTime } from "@/utils";
import {
  ArrowLeftIcon,
  CaretDownIcon,
  ListDashesIcon,
} from "@phosphor-icons/react";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import type { StepAttempt, WorkflowRun } from "openworkflow/internal";
import { useState } from "react";

export const Route = createFileRoute("/runs/$runId")({
  loader: async ({ params }) => {
    const [run, stepsResult] = await Promise.all([
      getWorkflowRunServerFn({ data: { workflowRunId: params.runId } }),
      listStepAttemptsServerFn({ data: { workflowRunId: params.runId } }),
    ]);
    const steps = stepsResult.data;

    let parentStepAttempt: StepAttempt | null = null;
    let parentRun: WorkflowRun | null = null;

    if (run?.parentStepAttemptId) {
      parentStepAttempt = await getStepAttemptServerFn({
        data: { stepAttemptId: run.parentStepAttemptId },
      });

      if (parentStepAttempt) {
        parentRun = await getWorkflowRunServerFn({
          data: { workflowRunId: parentStepAttempt.workflowRunId },
        });
      }
    }

    const childRunIds = [
      ...new Set(
        steps
          .map((step) =>
            step.kind === "workflow" ? step.childWorkflowRunId : null,
          )
          .filter((childRunId): childRunId is string => childRunId !== null),
      ),
    ];

    const childRunsById = Object.fromEntries(
      await Promise.all(
        childRunIds.map(async (childRunId) => [
          childRunId,
          await getWorkflowRunServerFn({
            data: { workflowRunId: childRunId },
          }),
        ]),
      ),
    ) as Record<string, WorkflowRun | null>;

    return {
      run,
      steps,
      parentStepAttempt,
      parentRun,
      childRunsById,
    };
  },
  component: RunDetailsPage,
});

function RunDetailsPage() {
  const { run, steps, parentRun, childRunsById } = Route.useLoaderData();
  const router = useRouter();
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());
  usePolling({
    enabled: !!run && !TERMINAL_RUN_STATUSES.has(run.status),
  });

  function toggleStep(stepId: string) {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(stepId)) {
        next.delete(stepId);
      } else {
        next.add(stepId);
      }
      return next;
    });
  }

  if (!run) {
    return (
      <AppLayout>
        <div className="py-12 text-center">
          <h2 className="mb-2 text-2xl font-bold">Run Not Found</h2>
          <p className="text-muted-foreground">
            The workflow run you're looking for doesn't exist.
          </p>
          <Link to="/" className="mt-4 inline-block">
            <Button variant="outline">Back to Dashboard</Button>
          </Link>
        </div>
      </AppLayout>
    );
  }

  const duration = computeDuration(run.startedAt, run.finishedAt);
  const startedAt = formatRelativeTime(run.startedAt);
  const completedSteps = steps.filter(
    (s: StepAttempt) => s.status === "completed" || s.status === "succeeded",
  ).length;

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
          <Link to="/">
            <Button variant="ghost" size="icon">
              <ArrowLeftIcon className="size-5" />
            </Button>
          </Link>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <h2 className="text-2xl font-semibold wrap-break-word">
                {run.workflowName}
              </h2>
              {run.version && <Badge variant="outline">{run.version}</Badge>}
              <Badge
                variant="outline"
                className={cn("capitalize", getStatusBadgeClass(run.status))}
              >
                {run.status}
              </Badge>
            </div>
            <p className="text-muted-foreground mt-1 text-sm">
              Run ID: <span className="font-mono break-all">{run.id}</span>
            </p>
            {parentRun && (
              <RunRelationRow
                label="Parent Workflow Run"
                runId={parentRun.id}
                workflowName={parentRun.workflowName}
                className="mt-2"
              />
            )}
          </div>
          <div className="sm:shrink-0">
            <RunCancelAction
              runId={run.id}
              status={run.status}
              onCanceled={async () => {
                await router.invalidate();
              }}
            />
          </div>
        </div>

        <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
          <div className="min-w-0 flex-1">
            <Card className="bg-card border-border overflow-hidden py-0">
              {steps.length === 0 ? (
                <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
                  <ListDashesIcon className="text-muted-foreground mb-4 size-16" />
                  <h3 className="mb-2 text-lg font-semibold">No steps yet</h3>
                  <p className="text-muted-foreground max-w-md text-sm">
                    This workflow run hasn't executed any steps yet. Steps will
                    appear here as they are processed.
                  </p>
                </div>
              ) : (
                <div className="divide-border divide-y">
                  {steps.map((step: StepAttempt, index: number) => {
                    const isExpanded = expandedSteps.has(step.id);
                    const config = STEP_STATUS_CONFIG[step.status];
                    const StatusIcon = config.icon;
                    const iconColor = config.color;
                    const stepTypeLabel =
                      step.kind === "function" ? "run" : step.kind;
                    const childRunId =
                      step.kind === "workflow" ? step.childWorkflowRunId : null;
                    const childRun = childRunId
                      ? (childRunsById[childRunId] ?? null)
                      : null;
                    const stepDuration = computeDuration(
                      step.startedAt,
                      step.finishedAt,
                    );
                    const stepStartedAt = formatRelativeTime(step.startedAt);

                    return (
                      <div key={step.id} className="group">
                        <button
                          onClick={() => {
                            toggleStep(step.id);
                          }}
                          className={cn(
                            "group-hover:bg-muted/50 flex w-full items-start gap-3 border-0 px-4 pt-4 pb-4 text-left transition-colors sm:items-center sm:gap-4 sm:px-6",
                            childRunId && "pb-2",
                          )}
                        >
                          <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center">
                            <div className="flex flex-col items-center gap-2">
                              <StatusIcon
                                className={cn(
                                  "size-5",
                                  iconColor,
                                  step.status === "running" && "animate-spin",
                                )}
                              />
                              {index < steps.length - 1 && (
                                <div className="bg-border h-8 w-0.5" />
                              )}
                            </div>

                            <div className="min-w-0 flex-1">
                              <div className="mb-1 flex flex-wrap items-center gap-2 sm:gap-3">
                                <span className="font-medium wrap-break-word">
                                  {step.stepName}
                                </span>
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    "capitalize",
                                    getStatusBadgeClass(step.status),
                                  )}
                                >
                                  {step.status}
                                </Badge>
                                <Badge variant="outline">{stepTypeLabel}</Badge>
                              </div>
                              <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                                <span>Started {stepStartedAt}</span>
                                <span>Duration: {stepDuration}</span>
                              </div>
                            </div>
                          </div>

                          <CaretDownIcon
                            className={cn(
                              "text-muted-foreground size-5 transition-transform",
                              isExpanded && "rotate-180",
                            )}
                          />
                        </button>

                        {childRunId && (
                          <div className="group-hover:bg-muted/50 px-4 pb-3 pl-10 transition-colors sm:px-6 sm:pl-14">
                            <RunRelationRow
                              label="Child Workflow Run"
                              runId={childRunId}
                              workflowName={childRun?.workflowName}
                            />
                          </div>
                        )}

                        {isExpanded && (
                          <div className="px-4 pt-2 pb-4 pl-10 sm:px-6 sm:pl-14">
                            <div className="bg-muted/50 rounded-lg p-4">
                              <p className="text-muted-foreground mb-2 text-sm font-medium">
                                {step.error ? "Error" : "Output"}
                              </p>
                              <pre className="font-mono text-sm wrap-break-word whitespace-pre-wrap">
                                {JSON.stringify(
                                  step.error ?? step.output,
                                  null,
                                  2,
                                )}
                              </pre>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>

          <div className="w-full shrink-0 lg:w-64">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-1">
              <Card className="bg-card border-border gap-2 p-3">
                <p className="text-muted-foreground text-xs">Status</p>
                <p
                  className={cn(
                    "text-base font-semibold capitalize",
                    getStatusColor(run.status),
                  )}
                >
                  {run.status}
                </p>
              </Card>
              <Card className="bg-card border-border gap-2 p-3">
                <p className="text-muted-foreground text-xs">Started</p>
                <p className="text-base font-semibold">{startedAt}</p>
              </Card>
              <Card className="bg-card border-border gap-2 p-3">
                <p className="text-muted-foreground text-xs">Duration</p>
                <p className="font-mono text-base font-semibold">{duration}</p>
              </Card>
              <Card className="bg-card border-border gap-2 p-3">
                <p className="text-muted-foreground text-xs">Steps</p>
                <p className="font-mono text-base font-semibold">
                  {completedSteps}/{steps.length}
                </p>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}

interface RunRelationRowProps {
  label: string;
  runId: string;
  workflowName?: string | undefined;
  className?: string | undefined;
}

function RunRelationRow({
  label,
  runId,
  workflowName,
  className,
}: RunRelationRowProps) {
  return (
    <div className={cn("flex flex-wrap items-start gap-2 text-sm", className)}>
      <span className="text-muted-foreground whitespace-nowrap">{label}:</span>
      <Badge
        variant="outline"
        className="h-auto max-w-full min-w-0 py-1 break-all whitespace-normal"
        render={<Link to="/runs/$runId" params={{ runId }} />}
      >
        {workflowName && (
          <span className="mr-2 font-medium wrap-break-word">
            [{workflowName}]
          </span>
        )}
        <span className="break-all">{runId}</span>
      </Badge>
    </div>
  );
}
