import { BackendPostgres } from "../packages/backend-postgres/index.js";
import { DEFAULT_DATABASE_URL } from "../packages/backend-postgres/postgres.js";
import { OpenWorkflow } from "../packages/openworkflow/index.js";
import { Worker } from "../packages/worker/index.js";
import { randomUUID } from "node:crypto";

const WORKFLOW_RUN_COUNT = 1000;
const WORKER_CONCURRENCY = 100;

async function main() {
  const namespaceId = randomUUID();
  const backend = new BackendPostgres(DEFAULT_DATABASE_URL);
  const client = new OpenWorkflow({
    backend,
    namespaceId,
  });

  const workflow = client.defineWorkflow(
    "benchmark-workflow",
    async ({ step }) => {
      await step.run("step-1", () => {
        return;
      });
      await step.run("step-2", () => {
        return;
      });
      await step.run("step-3", () => {
        return;
      });
      await step.run("step-4", () => {
        return;
      });
      return { completed: true };
    },
  );

  const worker = new Worker({
    backend,
    namespaceId,
    workflows: client.listWorkflowDefinitions(),
    concurrency: WORKER_CONCURRENCY,
  });

  console.log("Starting benchmark...");
  console.log("Configuration:");
  console.log(`  - Workflow count: ${WORKFLOW_RUN_COUNT.toString()}`);
  console.log(`  - Concurrency: ${WORKER_CONCURRENCY.toString()}`);
  console.log("  - Steps per workflow: 4");
  console.log("");

  console.log("Phase 1: Enqueuing workflows...");
  const enqueueStart = Date.now();

  const handles = await Promise.all(
    Array.from({ length: WORKFLOW_RUN_COUNT }, () =>
      workflow.run({ input: {} }),
    ),
  );

  const enqueueTime = Date.now() - enqueueStart;
  const enqueuePerSec = (WORKFLOW_RUN_COUNT / (enqueueTime / 1000)).toFixed(2);

  console.log(
    `Enqueued ${WORKFLOW_RUN_COUNT.toString()} workflows in ${enqueueTime.toString()}ms`,
  );
  console.log(`   (${enqueuePerSec} workflows/sec)`);
  console.log("");

  console.log("Phase 2: Processing workflows...");
  const processStart = Date.now();

  await worker.start();

  // wait for all workflows to complete
  await Promise.all(handles.map((h) => h.result()));

  const processTime = Date.now() - processStart;
  const totalTime = enqueueTime + processTime;

  await worker.stop();

  const workflowsPerSecond = (
    WORKFLOW_RUN_COUNT /
    (processTime / 1000)
  ).toFixed(2);
  const stepsPerSecond = (
    (WORKFLOW_RUN_COUNT * 4) /
    (processTime / 1000)
  ).toFixed(2);
  const avgLatencyMs = (processTime / WORKFLOW_RUN_COUNT).toFixed(2);

  console.log(
    `Processed ${WORKFLOW_RUN_COUNT.toString()} workflows in ${processTime.toString()}ms`,
  );
  console.log("");
  console.log("Results:");
  console.log("");
  console.log(`Enqueue Time:            ${enqueueTime.toString()}ms`);
  console.log(`Process Time:            ${processTime.toString()}ms`);
  console.log(`Total Time:              ${totalTime.toString()}ms`);
  console.log("");
  console.log(`Workflows Completed:     ${WORKFLOW_RUN_COUNT.toString()}`);
  console.log(
    `Steps Executed:          ${(WORKFLOW_RUN_COUNT * 4).toString()}`,
  );
  console.log("");
  console.log(`Workflows/sec:           ${workflowsPerSecond}`);
  console.log(`Steps/sec:               ${stepsPerSecond}`);
  console.log(`Avg Latency:             ${avgLatencyMs}ms`);

  await backend.end();
}

await main().catch((error: unknown) => {
  console.error("Benchmark failed:", error);
  throw error;
});
