import { AppLayout } from "@/components/app-layout";
import { StepNode } from "@/components/step-node";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  getWorkflowRunServerFn,
  listStepAttemptsServerFn,
  type SerializedStepAttempt,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { computeDuration, formatRelativeTime } from "@/types";
import {
  ArrowLeft,
  CaretDown,
  CheckCircle,
  CircleNotch,
  XCircle,
} from "@phosphor-icons/react";
import { createFileRoute, Link } from "@tanstack/react-router";
import type { Edge, Node } from "@xyflow/react";
import { Background, Controls, ReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useState } from "react";

const nodeTypes = {
  stepNode: StepNode,
};

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

type StepAttemptStatus = SerializedStepAttempt["status"];

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
  const [viewMode, setViewMode] = useState<"list" | "graph">("graph");

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
        <div className="text-center py-12">
          <h2 className="text-2xl font-bold mb-2">Run Not Found</h2>
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

  const nodes: Node[] = steps.map(
    (step: SerializedStepAttempt, index: number) => ({
      id: step.id,
      type: "stepNode",
      position: { x: 50 + index * 300, y: 100 },
      data: {
        step,
        onToggle: () => toggleStep(step.id),
        isExpanded: expandedSteps.has(step.id),
      },
    }),
  );

  const edges: Edge[] = steps
    .slice(0, -1)
    .map((step: SerializedStepAttempt, index: number) => {
      const nextStep = steps[index + 1];
      return {
        id: `${step.id}-${nextStep?.id}`,
        source: step.id,
        target: nextStep?.id ?? "",
        animated: nextStep?.status === "running",
        style: {
          stroke:
            step.status === "completed" || step.status === "succeeded"
              ? "rgb(34, 197, 94)"
              : step.status === "failed"
                ? "rgb(239, 68, 68)"
                : "rgb(100, 116, 139)",
        },
      };
    });

  const duration = computeDuration(run.startedAt, run.finishedAt);
  const startedAt = formatRelativeTime(run.startedAt);
  const completedSteps = steps.filter(
    (s: SerializedStepAttempt) =>
      s.status === "completed" || s.status === "succeeded",
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
                <Badge variant="outline" className="font-mono border-border">
                  {run.version}
                </Badge>
              )}
              <Badge
                variant="outline"
                className={`capitalize border-border ${getStatusBadgeClass(run.status)}`}
              >
                {run.status}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Run ID: <span className="font-mono">{run.id}</span>
            </p>
          </div>
        </div>

        <div className="flex gap-6">
          {/* Left side - Tabs and content */}
          <div className="flex-1">
            <Tabs
              value={viewMode}
              onValueChange={(v) => setViewMode(v as "list" | "graph")}
            >
              <TabsList className="mb-4" variant="line">
                <TabsTrigger value="graph">Graph</TabsTrigger>
                <TabsTrigger value="list">List</TabsTrigger>
              </TabsList>

              <TabsContent value="graph">
                <Card className="bg-card border-border overflow-hidden h-[600px] py-0">
                  <ReactFlow
                    nodes={nodes}
                    edges={edges}
                    nodeTypes={nodeTypes}
                    fitView
                    minZoom={0.5}
                    maxZoom={1.5}
                    defaultEdgeOptions={{
                      type: "smoothstep",
                    }}
                  >
                    <Background />
                    <Controls />
                  </ReactFlow>
                </Card>
              </TabsContent>

              <TabsContent value="list">
                <Card className="bg-card border-border overflow-hidden py-0">
                  <div className="divide-y divide-border">
                    {steps.map((step: SerializedStepAttempt, index: number) => {
                      const isExpanded = expandedSteps.has(step.id);
                      const config = stepStatusConfig[step.status];
                      const StatusIcon = config.icon;
                      const stepDuration = computeDuration(
                        step.startedAt,
                        step.finishedAt,
                      );
                      const stepStartedAt = formatRelativeTime(step.startedAt);

                      return (
                        <div key={step.id}>
                          <button
                            onClick={() => toggleStep(step.id)}
                            className="w-full px-6 py-4 flex items-center gap-4 hover:bg-muted/50 transition-colors text-left"
                          >
                            <div className="flex items-center gap-3 flex-1">
                              <div className="flex flex-col items-center gap-2">
                                <StatusIcon
                                  className={`size-5 ${config.color} ${
                                    step.status === "running"
                                      ? "animate-spin"
                                      : ""
                                  }`}
                                />
                                {index < steps.length - 1 && (
                                  <div className="w-0.5 h-8 bg-border" />
                                )}
                              </div>

                              <div className="flex-1">
                                <div className="flex items-center gap-3 mb-1">
                                  <span className="font-medium">
                                    {step.stepName}
                                  </span>
                                  <Badge
                                    variant="outline"
                                    className={`text-xs capitalize border-border ${getStatusBadgeClass(step.status)}`}
                                  >
                                    {step.status}
                                  </Badge>
                                  {step.kind === "sleep" && (
                                    <Badge
                                      variant="outline"
                                      className="text-xs border-border"
                                    >
                                      sleep
                                    </Badge>
                                  )}
                                </div>
                                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                                  <span>Started {stepStartedAt}</span>
                                  <span>Duration: {stepDuration}</span>
                                </div>
                              </div>
                            </div>

                            <CaretDown
                              className={`size-5 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`}
                            />
                          </button>

                          {isExpanded && (
                            <div className="px-6 pb-4 pl-20">
                              <div className="bg-muted/50 rounded-lg p-4">
                                <p className="text-sm font-medium text-muted-foreground mb-2">
                                  {step.error ? "Error" : "Output"}
                                </p>
                                <pre className="text-sm font-mono whitespace-pre-wrap">
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
                </Card>
              </TabsContent>
            </Tabs>
          </div>

          {/* Right side - Sidebar */}
          <div className="w-64 shrink-0 pt-14">
            <div className="grid grid-cols-1 gap-3">
              <Card className="p-3 bg-card border-border gap-2">
                <p className="text-xs text-muted-foreground">Status</p>
                <p
                  className={cn(
                    "text-base font-semibold capitalize",
                    getStatusColor(run.status),
                  )}
                >
                  {run.status}
                </p>
              </Card>
              <Card className="p-3 bg-card border-border gap-2">
                <p className="text-xs text-muted-foreground">Started</p>
                <p className="text-base font-semibold">{startedAt}</p>
              </Card>
              <Card className="p-3 bg-card border-border gap-2">
                <p className="text-xs text-muted-foreground">Duration</p>
                <p className="text-base font-semibold font-mono">{duration}</p>
              </Card>
              <Card className="p-3 bg-card border-border gap-2">
                <p className="text-xs text-muted-foreground">Steps</p>
                <p className="text-base font-semibold font-mono">
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
