import { OpenWorkflow } from "../client/client.js";
import type { WorkflowScheduleDefinition } from "../core/schedule.js";
import { BackendSqlite } from "../sqlite/backend.js";
import { createStubBackend } from "../testing/backend-stub.testsuite.js";
import { Worker } from "./worker.js";
import { describe, expect, test, vi } from "vitest";

describe("worker scheduling", () => {
  test("scheduling proceeds while every execution slot is occupied", async () => {
    const backend = BackendSqlite.connect(":memory:");
    const ow = new OpenWorkflow({ backend });
    const block = Promise.withResolvers<void>();
    let started = false;
    let scheduledExecuted = false;
    const blocker = ow.defineWorkflow({ name: "blocker" }, async () => {
      started = true;
      await block.promise;
    });
    const report = ow.defineWorkflow({ name: "report" }, () => {
      scheduledExecuted = true;
    });
    const worker = ow.newWorker({ concurrency: 1 });
    try {
      await report.schedule(undefined, { cron: "* * * * * *" });
      await blocker.run();
      await worker.start();
      await vi.waitFor(() => {
        expect(started).toBe(true);
      });
      backend["db"]
        .prepare("UPDATE workflow_schedules SET next_run_at=?")
        .run(new Date(Date.now() - 5000).toISOString());
      await vi.waitFor(
        async () => {
          const reportPage = await backend.listWorkflowRuns({
            workflowName: "report",
          });
          expect(reportPage.data.length).toBeGreaterThan(0);
        },
        { timeout: 2500 },
      );
      expect(scheduledExecuted).toBe(false);
    } finally {
      block.resolve();
      await worker.stop();
      await backend.stop();
    }
  });

  test("duplicate declarations preserve overdue runs on restart", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-02T12:00:00Z"));
    const backend = BackendSqlite.connect(":memory:");
    const ow = new OpenWorkflow({ backend });
    ow.defineWorkflow(
      {
        name: "earlier",
        schedules: [{ id: "report", cron: "0 * * * *" }],
      },
      () => null,
    );
    ow.defineWorkflow(
      {
        name: "report",
        schedules: [{ cron: "0 12 * * *" }, { cron: "0 0 * * *" }],
      },
      () => null,
    );
    const worker = ow.newWorker();
    try {
      await worker.start();
      await worker.stop();
      backend["db"]
        .prepare("UPDATE workflow_schedules SET next_run_at=? WHERE id=?")
        .run("2026-01-02T00:00:00.000Z", "report");
      await worker.start();
      await vi.waitFor(async () => {
        const page = await backend.listWorkflowRuns({});
        expect(page.data).toHaveLength(1);
        expect(page.data[0]).toMatchObject({
          workflowName: "report",
          workflowScheduleId: "report",
        });
      });
      const schedule = await ow.schedules.get("report");
      expect(schedule?.nextRunAt).toEqual(new Date("2026-01-03T00:00:00Z"));
    } finally {
      await worker.stop();
      await backend.stop();
      vi.useRealTimers();
    }
  });

  test.each(["success", "failure"])(
    "stop waits for registration %s and prevents background loops from starting afterward",
    async (outcome) => {
      const pending = Promise.withResolvers<void>();
      const register = vi.fn(async (definition: WorkflowScheduleDefinition) => {
        await pending.promise;
        return {
          ...definition,
          namespaceId: "test",
          nextRunAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      });
      const enqueue = vi.fn(() => Promise.resolve(0));
      const backend = createStubBackend({
        upsertWorkflowSchedule: register,
        enqueueScheduledRuns: enqueue,
      });
      const worker = new Worker({
        backend,
        workflows: [
          {
            spec: { name: "report", schedules: [{ cron: "0 * * * *" }] },
            fn: () => null,
          },
        ],
      });
      const first = worker.start();
      expect(worker.start()).toBe(first);
      await vi.waitFor(() => {
        expect(register).toHaveBeenCalledTimes(1);
      });
      const stop = worker.stop();
      if (outcome === "success") {
        pending.resolve();
        await first;
        await stop;
      } else {
        pending.reject(new Error("registration failed"));
        await expect(first).rejects.toThrow("registration failed");
        await expect(stop).rejects.toThrow("registration failed");
      }
      expect(enqueue).not.toHaveBeenCalled();
    },
  );

  test("schedule polling recovers after database and logger errors", async () => {
    const error = new Error("database busy");
    const enqueue = vi.fn().mockRejectedValueOnce(error).mockResolvedValue(0);
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(() => {
        throw new Error("logger failed");
      }),
    };
    const backend = createStubBackend({
      enqueueScheduledRuns: enqueue,
      claimWorkflowRun: () => Promise.resolve(null),
    });
    const worker = new Worker({ backend, workflows: [], logger });
    try {
      await worker.start();
      await vi.waitFor(
        () => {
          expect(enqueue).toHaveBeenCalledTimes(2);
        },
        {
          timeout: 2500,
        },
      );
      expect(logger.error).toHaveBeenCalledWith(
        "Worker schedule tick failed:",
        error,
      );
    } finally {
      await worker.stop();
    }
  });
});
