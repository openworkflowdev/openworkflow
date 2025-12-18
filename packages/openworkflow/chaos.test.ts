import { BackendPostgres } from "../backend-postgres/backend.js";
import { DEFAULT_DATABASE_URL } from "../backend-postgres/postgres.js";
import { OpenWorkflow } from "./client.js";
import { Worker } from "./worker.js";
import { randomInt, randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";

const TOTAL_STEPS = 50;
const WORKER_COUNT = 3;
const WORKER_CONCURRENCY = 2;
const STEP_DURATION_MS = 25;
const CHAOS_DURATION_MS = 5000;
const CHAOS_INTERVAL_MS = 200;
const TEST_TIMEOUT_MS = 30_000;

describe("chaos test", () => {
  test(
    "workflow completes despite random worker deaths",
    async () => {
      const backend = await createBackend();
      const client = new OpenWorkflow({ backend });

      const workflow = client.defineWorkflow(
        { name: "chaos-workflow" },
        async ({ step }) => {
          const results: number[] = [];
          for (let i = 0; i < TOTAL_STEPS; i++) {
            const stepName = `step-${i.toString()}`;
            const result = await step.run({ name: stepName }, async () => {
              await sleep(STEP_DURATION_MS); // fake work
              return i;
            });
            results.push(result);
          }
          return results;
        },
      );

      const workers = await Promise.all(
        Array.from({ length: WORKER_COUNT }, () =>
          createAndStartWorker(client),
        ),
      );

      const handle = await workflow.run();
      let workflowCompleted = false;
      let chaosTask: Promise<number> | null = null;

      try {
        chaosTask = runChaosTest({
          client,
          workers,
          durationMs: CHAOS_DURATION_MS,
          intervalMs: CHAOS_INTERVAL_MS,
          shouldStop: () => workflowCompleted,
        });

        const result = await handle.result();
        workflowCompleted = true;
        const restarts = await chaosTask;

        expect(result).toHaveLength(TOTAL_STEPS);
        expect(result[TOTAL_STEPS - 1]).toBe(TOTAL_STEPS - 1);
        expect(restarts).toBeGreaterThan(0);
      } finally {
        workflowCompleted = true;
        if (chaosTask) await chaosTask;
        await Promise.all(workers.map((worker) => worker.stop()));
        await backend.stop();
      }
    },
    TEST_TIMEOUT_MS,
  );
});

async function runChaosTest(params: {
  client: OpenWorkflow;
  workers: Worker[];
  durationMs: number;
  intervalMs: number;
  shouldStop: () => boolean;
}): Promise<number> {
  const { client, workers, durationMs, intervalMs, shouldStop } = params;
  const chaosEndsAt = Date.now() + durationMs;
  let restartCount = 0;

  while (Date.now() < chaosEndsAt && !shouldStop()) {
    await sleep(intervalMs);
    if (workers.length === 0) {
      workers.push(await createAndStartWorker(client));
      continue;
    }

    const index = randomInt(workers.length);
    const victim = workers.splice(index, 1)[0];
    await victim?.stop();

    const replacement = await createAndStartWorker(client);
    workers.push(replacement);
    restartCount++;
  }

  return restartCount;
}

async function createBackend(): Promise<BackendPostgres> {
  return await BackendPostgres.connect(DEFAULT_DATABASE_URL, {
    namespaceId: randomUUID(),
  });
}

async function createAndStartWorker(client: OpenWorkflow): Promise<Worker> {
  const worker = client.newWorker({ concurrency: WORKER_CONCURRENCY });
  await worker.start();
  return worker;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
