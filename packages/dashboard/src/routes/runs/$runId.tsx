import { AppLayout } from "@/components/app-layout";
import { RunCancelAction } from "@/components/run-cancel-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MonacoJsonEditor } from "@/components/ui/monaco-json-editor";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  getStepAttemptServerFn,
  getWorkflowRunServerFn,
  listStepAttemptsServerFn,
} from "@/lib/api";
import {
  STEP_ATTEMPTS_PAGE_SIZE_OPTIONS,
  type RunsPaginationSearch,
  resolveStepAttemptsPageSize,
  shouldShowPaginationControls,
  validateStepAttemptsPaginationSearch,
} from "@/lib/runs-page-pagination";
import {
  STEP_STATUS_CONFIG,
  TERMINAL_RUN_STATUSES,
  getRunStatusConfig,
  getStatusBadgeClass,
} from "@/lib/status";
import { usePolling } from "@/lib/use-polling";
import { cn } from "@/lib/utils";
import {
  computeDuration,
  formatMetadataTimestamp,
  formatRelativeTime,
  getListboxNavigationIndex,
} from "@/utils";
import { ArrowLeftIcon, ListDashesIcon } from "@phosphor-icons/react";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import type {
  StepAttempt,
  WorkflowRun,
  WorkflowRunStatus,
} from "openworkflow/internal";
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export const Route = createFileRoute("/runs/$runId")({
  validateSearch: validateStepAttemptsPaginationSearch,
  loaderDeps: ({ search }) => search,
  loader: async ({ params, deps }) => {
    const limit = resolveStepAttemptsPageSize(deps.limit);

    const [run, stepsResponse] = await Promise.all([
      getWorkflowRunServerFn({ data: { workflowRunId: params.runId } }),
      listStepAttemptsServerFn({
        data: {
          workflowRunId: params.runId,
          limit,
          after: deps.after,
          before: deps.before,
        },
      }),
    ]);
    const steps = stepsResponse.data;

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
      stepsResponse,
      parentStepAttempt,
      parentRun,
      childRunsById,
      referenceNow: new Date(),
    };
  },
  component: RunDetailsPage,
});

function RunDetailsPage() {
  const { run, stepsResponse, parentRun, childRunsById, referenceNow } =
    Route.useLoaderData();
  const { data: steps, pagination } = stepsResponse;
  const search = Route.useSearch();
  const params = Route.useParams();
  const navigate = Route.useNavigate();
  const router = useRouter();
  const [selectedStepId, setSelectedStepId] = useState<string | null>(() =>
    getDefaultSelectedStepId(steps),
  );
  const stepOptionButtonRefs = useRef<Record<string, HTMLButtonElement | null>>(
    {},
  );
  const stepPageSize = resolveStepAttemptsPageSize(search.limit);
  const showStepPagination = shouldShowPaginationControls(pagination);

  function updateStepSearch(next: Partial<RunsPaginationSearch>) {
    void navigate({
      to: "/runs/$runId",
      params: {
        runId: params.runId,
      },
      search: (previous) => ({
        ...previous,
        ...next,
      }),
    });
  }

  function handleStepPageSizeChange(value: string) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) {
      return;
    }

    const limit = resolveStepAttemptsPageSize(parsed);
    updateStepSearch({
      limit,
      after: undefined,
      before: undefined,
    });
  }

  function goToNextStepPage() {
    if (!pagination.next) {
      return;
    }

    updateStepSearch({
      after: pagination.next,
      before: undefined,
    });
  }

  function goToPreviousStepPage() {
    if (!pagination.prev) {
      return;
    }

    updateStepSearch({
      before: pagination.prev,
      after: undefined,
    });
  }

  usePolling({
    enabled: !!run && !TERMINAL_RUN_STATUSES.has(run.status),
  });

  useEffect(() => {
    setSelectedStepId((previousStepId) => {
      if (previousStepId && steps.some((step) => step.id === previousStepId)) {
        return previousStepId;
      }

      return getDefaultSelectedStepId(steps);
    });
  }, [steps]);

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

  const referenceNowMs = referenceNow.getTime();
  const duration = computeDuration(run.startedAt, run.finishedAt);
  const startedAt = formatRelativeTime(run.startedAt, referenceNowMs);
  const stepsByName = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const step of steps) {
      counts[step.stepName] = (counts[step.stepName] ?? 0) + 1;
    }
    return counts;
  }, [steps]);
  const stepAttemptIndexById = useMemo(() => {
    const seenByName: Record<string, number> = {};
    const attemptIndexes: Record<string, number> = {};
    for (const step of steps) {
      const attemptIndex = (seenByName[step.stepName] ?? 0) + 1;
      seenByName[step.stepName] = attemptIndex;
      attemptIndexes[step.id] = attemptIndex;
    }
    return attemptIndexes;
  }, [steps]);
  const selectedStep =
    selectedStepId === null
      ? null
      : (steps.find((step) => step.id === selectedStepId) ?? null);
  const selectedStepAttemptCount =
    selectedStep === null ? 0 : (stepsByName[selectedStep.stepName] ?? 1);
  const selectedStepIndex =
    selectedStepId === null
      ? -1
      : steps.findIndex((step) => step.id === selectedStepId);
  const selectedStepChildRun =
    selectedStep?.kind === "workflow" && selectedStep.childWorkflowRunId
      ? (childRunsById[selectedStep.childWorkflowRunId] ?? null)
      : null;

  function handleStepListboxKeyDown(
    event: KeyboardEvent<HTMLDivElement>,
  ): void {
    const nextStepIndex = getListboxNavigationIndex(
      event.key,
      selectedStepIndex,
      steps.length,
    );
    if (nextStepIndex === null) {
      return;
    }

    event.preventDefault();
    const nextStep = steps[nextStepIndex];
    if (!nextStep) {
      return;
    }

    setSelectedStepId(nextStep.id);
    stepOptionButtonRefs.current[nextStep.id]?.focus();
  }

  return (
    <AppLayout>
      <div className="space-y-4 sm:space-y-6">
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
            </div>
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

        <RunOverviewPanel
          run={run}
          startedAt={startedAt}
          duration={duration}
          referenceNow={referenceNowMs}
        />

        <div className="grid gap-4 sm:gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] xl:items-start">
          <Card className="bg-card border-border gap-0 overflow-hidden py-0">
            <div className="border-border bg-muted/20 border-b px-4 py-3 sm:px-6">
              <h3 className="text-sm font-semibold tracking-wide uppercase">
                Steps
              </h3>
            </div>

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
              <div
                className="divide-border divide-y"
                role="listbox"
                aria-label="Workflow steps"
                aria-activedescendant={
                  selectedStepId ? `step-option-${selectedStepId}` : undefined
                }
                onKeyDown={handleStepListboxKeyDown}
              >
                {steps.map((step: StepAttempt, index: number) => {
                  const config = STEP_STATUS_CONFIG[step.status];
                  const StatusIcon = config.icon;
                  const iconColor = config.color;
                  const stepTypeLabel =
                    step.kind === "function" ? "function" : step.kind;
                  const stepDuration = computeDuration(
                    step.startedAt,
                    step.finishedAt,
                  );
                  const stepStartedAt = formatRelativeTime(
                    step.startedAt,
                    referenceNowMs,
                  );
                  const childRunId =
                    step.kind === "workflow" ? step.childWorkflowRunId : null;
                  const childRun = childRunId
                    ? (childRunsById[childRunId] ?? null)
                    : null;
                  const attemptsForName = stepsByName[step.stepName] ?? 1;
                  const stepAttemptIndex = stepAttemptIndexById[step.id] ?? 1;
                  const stepAttemptLabel =
                    attemptsForName > 1
                      ? `${stepAttemptIndex.toString()}/${attemptsForName.toString()}`
                      : stepAttemptIndex.toString();
                  const isSelected = selectedStepId === step.id;

                  return (
                    <button
                      id={`step-option-${step.id}`}
                      key={step.id}
                      ref={(node) => {
                        stepOptionButtonRefs.current[step.id] = node;
                      }}
                      onClick={() => {
                        setSelectedStepId(step.id);
                      }}
                      role="option"
                      tabIndex={isSelected ? 0 : -1}
                      aria-selected={isSelected}
                      aria-posinset={index + 1}
                      aria-setsize={steps.length}
                      aria-controls="step-inspector-panel"
                      className={cn(
                        "w-full border-0 px-4 py-4 text-left transition-colors sm:px-6",
                        isSelected ? "bg-muted/60" : "hover:bg-muted/35",
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center sm:gap-4">
                          <StatusIcon
                            className={cn(
                              "mt-0.5 size-5 shrink-0 sm:mt-0",
                              iconColor,
                              step.status === "running" && "animate-spin",
                            )}
                          />

                          <div className="min-w-0 flex-1">
                            <div className="mb-1 flex min-w-0 flex-wrap items-center gap-2 sm:gap-3">
                              <span className="font-medium wrap-break-word">
                                {step.stepName}
                              </span>
                            </div>

                            <div className="text-muted-foreground mb-2 flex flex-wrap items-center gap-2 text-xs">
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

                            {childRunId && (
                              <RunRelationRow
                                label="Child Workflow Run"
                                runId={childRunId}
                                workflowName={childRun?.workflowName}
                                className="mb-2"
                              />
                            )}

                            <div className="mt-3 grid grid-cols-3 gap-2 text-xs sm:hidden">
                              <div>
                                <p className="text-muted-foreground">Started</p>
                                <p>{stepStartedAt}</p>
                              </div>
                              <div className="text-center">
                                <p className="text-muted-foreground">
                                  Duration
                                </p>
                                <p className="font-mono">{stepDuration}</p>
                              </div>
                              <div className="text-right">
                                <p className="text-muted-foreground">Attempt</p>
                                <p className="font-mono">{stepAttemptLabel}</p>
                              </div>
                            </div>
                          </div>

                          <div className="hidden items-center gap-8 text-sm sm:flex">
                            <div className="min-w-24 text-right">
                              <p className="text-muted-foreground">Started</p>
                              <p>{stepStartedAt}</p>
                            </div>

                            <div className="text-right">
                              <p className="text-muted-foreground">Duration</p>
                              <p className="font-mono">{stepDuration}</p>
                            </div>

                            <div className="min-w-14 text-right">
                              <p className="text-muted-foreground">Attempt</p>
                              <p className="font-mono">{stepAttemptLabel}</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {showStepPagination && (
              <div className="border-border bg-muted/20 flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 sm:px-6">
                <p className="text-muted-foreground text-xs">
                  Showing {steps.length} step{steps.length === 1 ? "" : "s"}
                </p>
                <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
                  <div className="flex items-center gap-2 sm:mr-1">
                    <p className="text-muted-foreground text-xs">Page size</p>
                    <Select
                      value={String(stepPageSize)}
                      onValueChange={handleStepPageSizeChange}
                    >
                      <SelectTrigger className="h-8 w-20">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STEP_ATTEMPTS_PAGE_SIZE_OPTIONS.map((option) => (
                          <SelectItem key={option} value={String(option)}>
                            {option}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 sm:flex-none"
                    type="button"
                    onClick={goToPreviousStepPage}
                    disabled={!pagination.prev}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 sm:flex-none"
                    type="button"
                    onClick={goToNextStepPage}
                    disabled={!pagination.next}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </Card>

          <StepInspectorPanel
            step={selectedStep}
            childRun={selectedStepChildRun}
            attemptCount={selectedStepAttemptCount}
            referenceNow={referenceNowMs}
          />
        </div>
      </div>
    </AppLayout>
  );
}

interface RunOverviewPanelProps {
  run: WorkflowRun;
  startedAt: string;
  duration: string;
  referenceNow: number;
}

function RunOverviewPanel({
  run,
  startedAt,
  duration,
  referenceNow,
}: RunOverviewPanelProps) {
  const availableAt = formatMetadataTimestamp(run.availableAt, referenceNow);
  const deadlineAt = formatMetadataTimestamp(run.deadlineAt, referenceNow);
  const statusConfig = getRunStatusConfig(run.status);
  const statusHelp = getRunStatusHelp(run.status);
  const hasRunErrorPayload = hasDebugValue(run.error);
  const runOutputValue = hasRunErrorPayload ? run.error : run.output;
  const runOutputTone: DebugSectionTone = hasRunErrorPayload
    ? "error"
    : "default";
  const runOutputEmptyState =
    run.status === "failed"
      ? "No output or error payload was recorded for this failed run."
      : "No output was recorded for this run.";

  return (
    <Card className="bg-card border-border p-3 sm:p-5">
      <div className="mb-3 space-y-2 sm:mb-4">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-muted-foreground shrink-0 text-xs">Run ID</span>
          <IdentifierValue value={run.id} />
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-muted-foreground shrink-0 text-xs">Status</span>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label="Status meaning"
                  className="inline-flex cursor-help items-center bg-transparent p-0"
                >
                  <Badge
                    variant="outline"
                    className={cn(
                      "capitalize",
                      getStatusBadgeClass(run.status),
                    )}
                  >
                    {statusConfig.label}
                  </Badge>
                </button>
              }
            />
            <TooltipContent>{statusHelp}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2 lg:grid-cols-3">
        <MetadataField label="Started" value={startedAt} />
        <MetadataField label="Duration" value={duration} mono />
        <MetadataField label="Attempts" value={run.attempts.toString()} mono />
      </div>

      <div className="mt-2 hidden gap-3 sm:mt-3 sm:grid sm:grid-cols-2 lg:grid-cols-3">
        <MetadataField
          label="Available At"
          value={availableAt.relative}
          secondaryValue={availableAt.iso}
          secondaryMono
          secondaryValueMode="tooltip"
        />
        <MetadataField
          label="Deadline At"
          value={deadlineAt.relative}
          secondaryValue={deadlineAt.iso}
          secondaryMono
          secondaryValueMode="tooltip"
        />
        <MetadataField
          label="Worker ID"
          value={run.workerId ?? "-"}
          mono
          className="text-muted-foreground text-xs font-normal"
        />
      </div>

      <details className="border-border/60 mt-2 rounded-lg border p-3 sm:mt-3 sm:hidden">
        <summary className="text-muted-foreground cursor-pointer text-xs font-semibold tracking-wide uppercase">
          More Metadata
        </summary>
        <div className="mt-3 grid gap-3">
          <MetadataField
            label="Available At"
            value={availableAt.relative}
            secondaryValue={availableAt.iso}
            secondaryMono
            secondaryValueMode="tooltip"
          />
          <MetadataField
            label="Deadline At"
            value={deadlineAt.relative}
            secondaryValue={deadlineAt.iso}
            secondaryMono
            secondaryValueMode="tooltip"
          />
          <MetadataField
            label="Worker ID"
            value={run.workerId ?? "-"}
            mono
            className="text-muted-foreground text-xs font-normal"
          />
        </div>
      </details>

      <details
        className="border-border/60 mt-2 rounded-lg border p-3 sm:mt-3"
        open={run.status === "failed"}
      >
        <summary className="text-muted-foreground cursor-pointer text-xs font-semibold tracking-wide uppercase">
          Workflow Payloads
        </summary>
        <div className="mt-3 grid gap-3 xl:grid-cols-2">
          <MetadataDebugSection
            title="Input"
            value={run.input}
            tone="default"
            emptyState="No input was recorded for this run."
          />
          <MetadataDebugSection
            title="Output"
            value={runOutputValue}
            tone={runOutputTone}
            emptyState={runOutputEmptyState}
          />
        </div>
      </details>
    </Card>
  );
}

interface StepInspectorPanelProps {
  step: StepAttempt | null;
  childRun: WorkflowRun | null;
  attemptCount: number;
  referenceNow: number;
}

function StepInspectorPanel({
  step,
  childRun,
  attemptCount,
  referenceNow,
}: StepInspectorPanelProps) {
  if (!step) {
    return (
      <Card className="bg-card border-border gap-0 p-5">
        <h3 className="text-base font-semibold">Step Inspector</h3>
        <p className="text-muted-foreground mt-2 text-sm">
          Select a step to inspect its details.
        </p>
      </Card>
    );
  }

  const hasErrorPayload = hasDebugValue(step.error);
  const outputValue = hasErrorPayload ? step.error : step.output;
  const outputTone: DebugSectionTone = hasErrorPayload ? "error" : "default";
  const outputEmptyState =
    step.status === "failed"
      ? "No output or error payload was recorded for this failed step."
      : "No output was recorded for this step.";

  return (
    <Card
      id="step-inspector-panel"
      className="bg-card border-border gap-0 p-4 sm:p-5"
    >
      <div className="space-y-3">
        <div>
          <h3 className="text-base font-semibold">Step Inspector</h3>
          <p className="text-muted-foreground mt-1 text-sm">{step.stepName}</p>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex min-w-0 items-center gap-2">
              <span className="text-muted-foreground shrink-0 text-xs">
                Step Attempt ID
              </span>
              <IdentifierValue value={step.id} />
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <MetadataField
              label="Attempts for Step Name"
              value={attemptCount.toString()}
              mono
            />
            <MetadataTimestampField
              label="Started At"
              value={step.startedAt}
              referenceNow={referenceNow}
            />
            <MetadataTimestampField
              label="Finished At"
              value={step.finishedAt}
              referenceNow={referenceNow}
            />
          </div>
          {step.childWorkflowRunId && (
            <RunRelationRow
              label="Child Workflow Run"
              runId={step.childWorkflowRunId}
              workflowName={childRun?.workflowName}
            />
          )}
        </div>

        <MetadataDebugSection
          title="Output"
          value={outputValue}
          tone={outputTone}
          emptyState={outputEmptyState}
        />
      </div>
    </Card>
  );
}

interface MetadataFieldProps {
  label: string;
  value: string;
  secondaryValue?: string | null;
  mono?: boolean;
  secondaryMono?: boolean;
  secondaryValueMode?: "inline" | "tooltip";
  className?: string;
}

function MetadataField({
  label,
  value,
  secondaryValue,
  mono = false,
  secondaryMono = false,
  secondaryValueMode = "inline",
  className,
}: MetadataFieldProps) {
  const primaryValueClassName = cn(
    "mt-1 text-sm font-semibold break-all",
    mono && "font-mono",
    className,
  );

  const primaryValueNode: ReactNode =
    secondaryValue && secondaryValueMode === "tooltip" ? (
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              className={cn(
                primaryValueClassName,
                "cursor-help text-left decoration-dotted underline-offset-2 hover:underline focus-visible:underline",
              )}
              aria-label={`${label} full timestamp`}
            >
              {value}
            </button>
          }
        />
        <TooltipContent>
          <p className={cn("text-xs break-all", secondaryMono && "font-mono")}>
            {secondaryValue}
          </p>
        </TooltipContent>
      </Tooltip>
    ) : (
      <p className={primaryValueClassName}>{value}</p>
    );

  return (
    <div className="bg-muted/40 border-border/60 rounded-lg border p-3">
      <p className="text-muted-foreground text-xs">{label}</p>
      {primaryValueNode}
      {secondaryValue && secondaryValueMode === "inline" && (
        <p
          className={cn(
            "text-muted-foreground mt-1 text-xs break-all",
            secondaryMono && "font-mono",
          )}
        >
          {secondaryValue}
        </p>
      )}
    </div>
  );
}

function IdentifierValue({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "text-muted-foreground inline-flex max-w-full items-center font-mono text-xs break-all",
        className,
      )}
    >
      {value}
    </span>
  );
}

interface MetadataTimestampFieldProps {
  label: string;
  value: Date | null;
  referenceNow: number;
}

function MetadataTimestampField({
  label,
  value,
  referenceNow,
}: MetadataTimestampFieldProps) {
  const formatted = formatMetadataTimestamp(value, referenceNow);
  return (
    <MetadataField
      label={label}
      value={formatted.relative}
      secondaryValue={formatted.iso}
      secondaryMono
      secondaryValueMode="tooltip"
    />
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
    <div className={cn("flex flex-wrap items-center gap-2 text-sm", className)}>
      <span className="text-muted-foreground whitespace-nowrap">{label}:</span>
      {workflowName && (
        <span className="text-muted-foreground text-xs wrap-break-word">
          [{workflowName}]
        </span>
      )}
      <Link to="/runs/$runId" params={{ runId }}>
        <IdentifierValue value={runId} />
      </Link>
    </div>
  );
}

type DebugSectionTone = "default" | "error";

interface DebugValueSectionProps {
  title: string;
  value: unknown;
  tone: DebugSectionTone;
}

interface MetadataDebugSectionProps {
  title: string;
  value: unknown;
  tone: DebugSectionTone;
  emptyState: string;
}

function MetadataDebugSection({
  title,
  value,
  tone,
  emptyState,
}: MetadataDebugSectionProps) {
  if (hasDebugValue(value)) {
    return <DebugValueSection title={title} value={value} tone={tone} />;
  }

  return (
    <div
      className={cn(
        "rounded-lg border p-4",
        tone === "error"
          ? "border-destructive/30 bg-destructive/5"
          : "bg-muted/50 border-border",
      )}
    >
      <p
        className={cn(
          "text-sm font-medium",
          tone === "error" ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {title}
      </p>
      <p className="text-muted-foreground mt-2 text-sm">{emptyState}</p>
    </div>
  );
}

function DebugValueSection({ title, value, tone }: DebugValueSectionProps) {
  const [copied, setCopied] = useState(false);
  const [isClient, setIsClient] = useState(false);
  const serializedValue = stringifyDebugValue(value);
  const useStructuredEditor = shouldUseStructuredEditor(value, serializedValue);

  useEffect(() => {
    setIsClient(true);
  }, []);

  async function copyPayload() {
    try {
      await navigator.clipboard.writeText(serializedValue);
      setCopied(true);
      globalThis.setTimeout(() => {
        setCopied(false);
      }, 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div
      className={cn(
        "rounded-lg border p-4",
        tone === "error"
          ? "border-destructive/30 bg-destructive/5"
          : "bg-muted/50 border-border",
      )}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p
          className={cn(
            "text-sm font-medium",
            tone === "error" ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {title}
        </p>
        <Button
          variant="outline"
          size="xs"
          onClick={() => {
            void copyPayload();
          }}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>

      {isClient && useStructuredEditor ? (
        <MonacoJsonEditor
          value={serializedValue}
          readOnly
          minLines={6}
          maxLines={20}
        />
      ) : (
        <pre className="bg-background border-border max-h-80 overflow-auto border p-3 text-xs">
          <code>{serializedValue}</code>
        </pre>
      )}
    </div>
  );
}

function getDefaultSelectedStepId(
  steps: readonly StepAttempt[],
): string | null {
  if (steps.length === 0) {
    return null;
  }

  const failedStep = steps.find((step) => step.status === "failed");
  if (failedStep) {
    return failedStep.id;
  }

  const runningStep = steps.find((step) => step.status === "running");
  if (runningStep) {
    return runningStep.id;
  }

  return steps.at(-1)?.id ?? null;
}

function getRunStatusHelp(status: string): string {
  switch (status as WorkflowRunStatus) {
    case "pending": {
      return "Queued and waiting for an available worker to claim it.";
    }
    case "running": {
      return "Currently executing on a worker.";
    }
    case "completed":
    case "succeeded": {
      return "Finished successfully.";
    }
    case "failed": {
      return "Stopped after an unrecoverable error, deadline, or exhausted retries.";
    }
    case "canceled": {
      return "Manually canceled and will not continue.";
    }
    case "sleeping": {
      return "Legacy state: paused until it becomes available again.";
    }
    default: {
      return "Current workflow run status.";
    }
  }
}

function hasDebugValue(value: unknown): boolean {
  return value !== null && value !== undefined;
}

function shouldUseStructuredEditor(
  value: unknown,
  serializedValue: string,
): boolean {
  if (typeof value === "object" && value !== null) {
    return true;
  }

  if (serializedValue.length > 320) {
    return true;
  }

  return serializedValue.includes("\n");
}

function normalizeDebugValue(value: unknown): unknown {
  return normalizeValue(value, new WeakSet());
}

function normalizeValue(value: unknown, seen: WeakSet<object>): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  if (value === undefined) {
    return "[undefined]";
  }

  if (typeof value === "bigint") {
    return `${value.toString()}n`;
  }

  if (typeof value === "function") {
    return `[function ${value.name || "anonymous"}]`;
  }

  if (typeof value === "symbol") {
    return value.toString();
  }

  if (value === null) {
    return null;
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return "[circular]";
    }
    seen.add(value);
    return value.map((item) => normalizeValue(item, seen));
  }

  if (typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    if (seen.has(objectValue)) {
      return "[circular]";
    }
    seen.add(objectValue);

    const normalizedEntries = Object.entries(objectValue).map(
      ([key, entryValue]) => [key, normalizeValue(entryValue, seen)] as const,
    );
    return Object.fromEntries(normalizedEntries);
  }

  return value;
}

function stringifyDebugValue(value: unknown): string {
  try {
    return JSON.stringify(normalizeDebugValue(value), null, 2);
  } catch (error) {
    if (error instanceof Error) {
      return `${error.name}: ${error.message}`;
    }
    return "Unable to stringify debug payload";
  }
}
