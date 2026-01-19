import { AppLayout } from "@/components/app-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getWorkflowRunServerFn, listStepAttemptsServerFn } from "@/lib/api";
import { cn } from "@/lib/utils";
import { computeDuration, formatRelativeTime } from "@/utils";
import {
  ArrowLeft,
  CaretDown,
  CheckCircle,
  CircleNotch,
  XCircle,
  ListDashes,
} from "@phosphor-icons/react";
import { createFileRoute, Link } from "@tanstack/react-router";
import type { StepAttempt, StepAttemptStatus } from "openworkflow/internal";
import { useState } from "react";

export const Route = createFileRoute("/runs/$runId")({
  loader: async ({ params }) => {
    const [run, stepsResult] = await Promise.all([
      getWorkflowRunServerFn({ data: { workflowRunId: params.runId } }),
      listStepAttemptsServerFn({ data: { workflowRunId: params.runId } }),
    ]);
    return { run, steps: stepsResult.data };
  },
  component: RunDetailsPage,
});

// Step attempts have fewer statuses than workflow runs
const stepStatusConfig: Record<
  StepAttemptStatus,
  { icon: typeof CheckCircle; color: string }
> = {
  completed: { icon: CheckCircle, color: "text-green-500" },
  succeeded: { icon: CheckCircle, color: "text-green-500" },
  running: { icon: CircleNotch, color: "text-blue-500" },
  failed: { icon: XCircle, color: "text-red-500" },
};

function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    completed: "text-green-500",
    succeeded: "text-green-500",
    running: "text-blue-500",
    failed: "text-red-500",
    sleeping: "text-purple-500",
    canceled: "text-gray-500",
  };
  return colors[status] ?? "text-yellow-500";
}

function getStatusBadgeClass(status: string): string {
  const classes: Record<string, string> = {
    completed: "bg-green-500/10 text-green-500 border-green-500/20",
    succeeded: "bg-green-500/10 text-green-500 border-green-500/20",
    running: "bg-blue-500/10 text-blue-500 border-blue-500/20",
    failed: "bg-red-500/10 text-red-500 border-red-500/20",
    sleeping: "bg-purple-500/10 text-purple-500 border-purple-500/20",
    canceled: "bg-gray-500/10 text-gray-500 border-gray-500/20",
  };
  return (
    classes[status] ?? "bg-yellow-500/10 text-yellow-500 border-yellow-500/20"
  );
}

function RunDetailsPage() {
  const { run, steps } = Route.useLoaderData();
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());

  const toggleStep = (stepId: string) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(stepId)) {
        next.delete(stepId);
      } else {
        next.add(stepId);
      }
      return next;
    });
  };

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
        <div className="flex items-center gap-4">
          <Link to="/">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="size-5" />
            </Button>
          </Link>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-semibold">{run.workflowName}</h2>
              {run.version && (
                <Badge variant="outline" className="border-border font-mono">
                  {run.version}
                </Badge>
              )}
              <Badge
                variant="outline"
                className={`border-border capitalize ${getStatusBadgeClass(run.status)}`}
              >
                {run.status}
              </Badge>
            </div>
            <p className="text-muted-foreground mt-1 text-sm">
              Run ID: <span className="font-mono">{run.id}</span>
            </p>
          </div>
        </div>

        <div className="flex gap-6">
          {/* Left side - Steps list */}
          <div className="flex-1">
            <Card className="bg-card border-border overflow-hidden py-0">
              {steps.length === 0 ? (
                <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
                  <ListDashes className="text-muted-foreground mb-4 size-16" />
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
                    const config = stepStatusConfig[step.status];
                    const StatusIcon = config?.icon ?? CircleNotch;
                    const iconColor = config?.color ?? "text-gray-500";
                    const stepDuration = computeDuration(
                      step.startedAt,
                      step.finishedAt,
                    );
                    const stepStartedAt = formatRelativeTime(step.startedAt);

                    return (
                      <div key={step.id}>
                        <button
                          onClick={() => toggleStep(step.id)}
                          className="hover:bg-muted/50 flex w-full items-center gap-4 px-6 py-4 text-left transition-colors"
                        >
                          <div className="flex flex-1 items-center gap-3">
                            <div className="flex flex-col items-center gap-2">
                              <StatusIcon
                                className={`size-5 ${iconColor} ${
                                  step.status === "running"
                                    ? "animate-spin"
                                    : ""
                                }`}
                              />
                              {index < steps.length - 1 && (
                                <div className="bg-border h-8 w-0.5" />
                              )}
                            </div>

                            <div className="flex-1">
                              <div className="mb-1 flex items-center gap-3">
                                <span className="font-medium">
                                  {step.stepName}
                                </span>
                                <Badge
                                  variant="outline"
                                  className={`border-border text-xs capitalize ${getStatusBadgeClass(step.status)}`}
                                >
                                  {step.status}
                                </Badge>
                                {step.kind === "sleep" && (
                                  <Badge
                                    variant="outline"
                                    className="border-border text-xs"
                                  >
                                    sleep
                                  </Badge>
                                )}
                              </div>
                              <div className="text-muted-foreground flex items-center gap-4 text-sm">
                                <span>Started {stepStartedAt}</span>
                                <span>Duration: {stepDuration}</span>
                              </div>
                            </div>
                          </div>

                          <CaretDown
                            className={`text-muted-foreground size-5 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                          />
                        </button>

                        {isExpanded && (
                          <div className="px-6 pb-4 pl-20">
                            <div className="bg-muted/50 rounded-lg p-4">
                              <p className="text-muted-foreground mb-2 text-sm font-medium">
                                {step.error ? "Error" : "Output"}
                              </p>
                              <pre className="font-mono text-sm whitespace-pre-wrap">
                                {JSON.stringify(
                                  step.error || step.output,
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

          {/* Right side - Sidebar */}
          <div className="w-64 shrink-0 pt-14">
            <div className="grid grid-cols-1 gap-3">
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
