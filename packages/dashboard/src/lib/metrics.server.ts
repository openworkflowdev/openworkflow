import { getBackend } from "./backend";
import type { WorkflowRunCounts } from "openworkflow/internal";
import { Gauge, Registry } from "prom-client";

/**
 * Build the Prometheus response for the dashboard metrics endpoint.
 * @returns Prometheus response for /metrics
 */
export async function getMetricsResponse(): Promise<Response> {
  try {
    const backend = await getBackend();
    const workflowRunCounts = await backend.countWorkflowRuns();

    const registry = new Registry();
    registerWorkflowRunCounts(registry, workflowRunCounts);

    return new Response(await registry.metrics(), {
      status: 200,
      headers: {
        "content-type": registry.contentType,
      },
    });
  } catch {
    return new Response("failed to collect metrics\n", {
      status: 500,
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
    });
  }
}

const PROMETHEUS_WORKFLOW_RUN_STATUSES = [
  "pending",
  "running",
  "completed",
  "failed",
  "canceled",
] as const;

function registerWorkflowRunCounts(
  registry: Registry,
  workflowRunCounts: WorkflowRunCounts,
) {
  const prometheusCounts = toPrometheusWorkflowRunCounts(workflowRunCounts);
  const workflowRunsGauge = new Gauge({
    name: "openworkflow_workflow_runs",
    help: "Current count of workflow runs in each status.",
    labelNames: ["status"] as const,
    registers: [registry],
  });

  for (const status of PROMETHEUS_WORKFLOW_RUN_STATUSES) {
    workflowRunsGauge.set({ status }, prometheusCounts[status]);
  }
}

function toPrometheusWorkflowRunCounts(workflowRunCounts: WorkflowRunCounts) {
  return {
    pending: workflowRunCounts.pending,
    running: workflowRunCounts.running,
    completed: workflowRunCounts.completed,
    failed: workflowRunCounts.failed,
    canceled: workflowRunCounts.canceled,
  };
}
