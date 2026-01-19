import { AppLayout } from "@/components/app-layout";
import { StepNode } from "@/components/step-node";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { getRunById, getWorkflowById, runSteps } from "@/mocks/mock-data";
import type { StepAttempt } from "@/types";
import {
  ArrowLeft,
  CaretDown,
  CheckCircle,
  CircleNotch,
  Clock,
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

export const Route = createFileRoute("/workflows/$workflowId/runs/$runId")({
  component: RunDetailsPage,
});

function RunDetailsPage() {
  const { workflowId, runId } = Route.useParams();
  const workflow = getWorkflowById(workflowId);
  const run = getRunById(workflowId, runId);
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<"list" | "graph">("graph");

  const toggleStep = (stepName: string) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(stepName)) {
        next.delete(stepName);
      } else {
        next.add(stepName);
      }
      return next;
    });
  };

  if (!workflow || !run) {
    return (
      <AppLayout>
        <div className="text-center py-12">
          <h2 className="text-2xl font-bold mb-2">Run Not Found</h2>
          <p className="text-muted-foreground">
            The workflow run you're looking for doesn't exist.
          </p>
        </div>
      </AppLayout>
    );
  }

  const nodes: Array<Node> = runSteps.map((step, index) => ({
    id: step.name,
    type: "stepNode",
    position: { x: 50 + index * 300, y: 100 },
    data: {
      step,
      onToggle: () => toggleStep(step.name),
      isExpanded: expandedSteps.has(step.name),
    },
  }));

  const edges: Array<Edge> = runSteps.slice(0, -1).map((step, index) => ({
    id: `${step.name}-${runSteps[index + 1].name}`,
    source: step.name,
    target: runSteps[index + 1].name,
    animated: runSteps[index + 1].status === "running",
    style: {
      stroke:
        runSteps[index].status === "completed"
          ? "rgb(34, 197, 94)"
          : runSteps[index].status === "failed"
            ? "rgb(239, 68, 68)"
            : "rgb(100, 116, 139)",
    },
  }));

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Link to="/workflows/$workflowId" params={{ workflowId }}>
            <Button variant="ghost" size="icon">
              <ArrowLeft className="size-5" />
            </Button>
          </Link>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-semibold">{workflow.name}</h2>
              <Badge variant="outline" className="font-mono border-border">
                {workflow.version}
              </Badge>
              <Badge
                variant="outline"
                className={`capitalize border-border ${
                  run.status === "completed"
                    ? "bg-green-500/10 text-green-500 border-green-500/20"
                    : run.status === "running"
                      ? "bg-blue-500/10 text-blue-500 border-blue-500/20"
                      : run.status === "failed"
                        ? "bg-red-500/10 text-red-500 border-red-500/20"
                        : "bg-yellow-500/10 text-yellow-500 border-yellow-500/20"
                }`}
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
                    {runSteps.map((step, index) => {
                      const isExpanded = expandedSteps.has(step.name);
                      const StatusIcon =
                        step.status === "completed"
                          ? CheckCircle
                          : step.status === "running"
                            ? CircleNotch
                            : step.status === "failed"
                              ? XCircle
                              : Clock;

                      return (
                        <div key={step.name}>
                          <button
                            onClick={() => toggleStep(step.name)}
                            className="w-full px-6 py-4 flex items-center gap-4 hover:bg-muted/50 transition-colors text-left"
                          >
                            <div className="flex items-center gap-3 flex-1">
                              <div className="flex flex-col items-center gap-2">
                                <StatusIcon
                                  className={`size-5 ${
                                    step.status === "completed"
                                      ? "text-green-500"
                                      : step.status === "running"
                                        ? "text-blue-500 animate-spin"
                                        : step.status === "failed"
                                          ? "text-red-500"
                                          : "text-yellow-500"
                                  }`}
                                />
                                {index < runSteps.length - 1 && (
                                  <div className="w-0.5 h-8 bg-border" />
                                )}
                              </div>

                              <div className="flex-1">
                                <div className="flex items-center gap-3 mb-1">
                                  <span className="font-medium">
                                    {step.name}
                                  </span>
                                  <Badge
                                    variant="outline"
                                    className="text-xs capitalize border-border"
                                  >
                                    {step.status}
                                  </Badge>
                                </div>
                                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                                  <span>Started {step.startedAt}</span>
                                  {step.duration && (
                                    <span>Duration: {step.duration}</span>
                                  )}
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
                                  {step.error ? "Error" : "Result"}
                                </p>
                                <pre className="text-sm font-mono whitespace-pre-wrap">
                                  {JSON.stringify(
                                    step.error || step.result,
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
                  className={cn("text-base font-semibold capitalize", {
                    "text-green-500": run.status === "completed",
                    "text-blue-500": run.status === "running",
                    "text-red-500": run.status === "failed",
                    "text-yellow-500": run.status === "pending",
                  })}
                >
                  {run.status}
                </p>
              </Card>
              <Card className="p-3 bg-card border-border gap-2">
                <p className="text-xs text-muted-foreground ">Started</p>
                <p className="text-base font-semibold">{run.startedAt}</p>
              </Card>
              <Card className="p-3 bg-card border-border gap-2">
                <p className="text-xs text-muted-foreground ">Duration</p>
                <p className="text-base font-semibold font-mono">
                  {run.duration || "—"}
                </p>
              </Card>
              <Card className="p-3 bg-card border-border gap-2">
                <p className="text-xs text-muted-foreground ">Steps</p>
                <p className="text-base font-semibold font-mono">
                  {run.steps.completed}/{run.steps.total}
                </p>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
