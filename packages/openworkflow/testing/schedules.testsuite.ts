import { OpenWorkflow } from "../client/client.js";
import type { Backend } from "../core/backend.js";
import { defineWorkflowSpec } from "../core/workflow-definition.js";
import type { TestBackendOptions } from "./backend.testsuite.js";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

/**
 * Exercise identical schedule contracts on every backend.
 * @param options - Isolated backend factory and cleanup
 */
export function testWorkflowSchedules(options: TestBackendOptions): void {
  describe("recurring schedule persistence", () => {
    let backend: Backend;
    let ow: OpenWorkflow;
    const spec = defineWorkflowSpec<{ accountId: string }>({ name: "report" });
    const input = { accountId: "acme" };
    const config = { cron: "0 * * * *" };

    beforeEach(async () => {
      backend = await options.setup();
      ow = new OpenWorkflow({ backend });
    });
    afterEach(async () => {
      await options.teardown(backend);
    });

    test("last-write-wins uses the current input and preserves dispatch progress", async () => {
      const first = await ow.scheduleWorkflow(spec, input, config);
      const replaced = await ow.scheduleWorkflow(
        spec,
        { accountId: "other" },
        config,
      );
      expect(replaced.nextRunAt).toEqual(first.nextRunAt);
      const before = new Date(Date.now() + 86_400_000);
      expect(await backend.enqueueScheduledRuns({ before, limit: 100 })).toBe(
        1,
      );
      const advanced = await ow.schedules.get(first.id);
      const repeated = await ow.scheduleWorkflow(spec, input, config);
      expect(repeated.nextRunAt).toEqual(advanced?.nextRunAt);
      expect(repeated.createdAt).toEqual(first.createdAt);
      const runPage = await backend.listWorkflowRuns({});
      expect(runPage.data[0]).toMatchObject({
        workflowScheduleId: first.id,
        version: null,
        input: { accountId: "other" },
        availableAt: before,
      });
    });

    test("repeated or competing dispatches insert exactly one run", async () => {
      const schedule = await ow.scheduleWorkflow(spec, input, config);
      const before = new Date(Date.now() + 86_400_000);
      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          backend.enqueueScheduledRuns({ before, limit: 100 }),
        ),
      );
      expect(results.reduce((sum, count) => sum + count, 0)).toBe(1);
      expect(await backend.enqueueScheduledRuns({ before, limit: 100 })).toBe(
        0,
      );
      const runPage = await backend.listWorkflowRuns({});
      expect(runPage.data).toHaveLength(1);
      const advanced = await ow.schedules.get(schedule.id);
      expect(advanced?.nextRunAt?.getTime()).toBeGreaterThan(before.getTime());
    });

    test("pause clears the next time, registration preserves it, and resume starts in the future", async () => {
      const schedule = await ow.scheduleWorkflow(spec, input, config);
      const paused = await ow.schedules.pause(schedule.id);
      expect(paused.nextRunAt).toBeNull();
      expect(await ow.schedules.pause(schedule.id)).toEqual(paused);
      const replaced = await ow.scheduleWorkflow(spec, input, {
        cron: "15 * * * *",
      });
      expect(replaced.nextRunAt).toBeNull();
      expect(
        await backend.enqueueScheduledRuns({
          before: new Date(Date.now() + 86_400_000),
          limit: 100,
        }),
      ).toBe(0);
      const now = Date.now();
      const resumed = await ow.schedules.resume(schedule.id);
      expect(resumed.nextRunAt?.getTime()).toBeGreaterThan(now);
      expect(resumed.nextRunAt?.getUTCMinutes()).toBe(15);
      expect(await ow.schedules.resume(schedule.id)).toEqual(resumed);
    });

    test("deletion stops dispatch and preserves run attribution", async () => {
      const schedule = await ow.scheduleWorkflow(spec, input, config);
      const before = new Date(Date.now() + 86_400_000);
      await backend.enqueueScheduledRuns({ before, limit: 100 });
      await ow.schedules.delete(schedule.id);
      await ow.schedules.delete(schedule.id);
      expect(await ow.schedules.get(schedule.id)).toBeNull();
      expect(await backend.enqueueScheduledRuns({ before, limit: 100 })).toBe(
        0,
      );
      const runPage = await backend.listWorkflowRuns({});
      expect(runPage.data[0]?.workflowScheduleId).toBe(schedule.id);
      const schedulePage = await ow.schedules.list();
      expect(schedulePage.data).toEqual([]);
    });

    test("cron and timezone changes reset active schedules to the next future time", async () => {
      await ow.scheduleWorkflow(spec, input, config);
      await backend.enqueueScheduledRuns({
        before: new Date(Date.now() + 86_400_000),
        limit: 100,
      });
      const changed = await ow.scheduleWorkflow(spec, input, {
        cron: "15 * * * *",
      });
      expect(changed.nextRunAt?.getUTCMinutes()).toBe(15);
      const timezone = await ow.scheduleWorkflow(spec, input, {
        cron: "0 9 * * *",
        timezone: "Asia/Kolkata",
      });
      expect(timezone.nextRunAt?.getUTCHours()).toBe(3);
      expect(timezone.nextRunAt?.getUTCMinutes()).toBe(30);
    });

    test("dispatch is bounded and collapses years of missed occurrences into one run per schedule", async () => {
      for (const id of ["a", "b", "c"])
        await ow.scheduleWorkflow(spec, input, { id, cron: "* * * * * *" });
      const before = new Date(Date.now() + 5 * 365 * 86_400_000);
      expect(await backend.enqueueScheduledRuns({ before, limit: 2 })).toBe(2);
      expect(await backend.enqueueScheduledRuns({ before, limit: 2 })).toBe(1);
      expect(await backend.enqueueScheduledRuns({ before, limit: 2 })).toBe(0);
      const runPage = await backend.listWorkflowRuns({});
      expect(
        runPage.data
          .map((run) => run.workflowScheduleId)
          .toSorted((a, b) => (a ?? "").localeCompare(b ?? "")),
      ).toEqual(["a", "b", "c"]);
      const schedulePage = await ow.schedules.list();
      for (const schedule of schedulePage.data)
        expect(schedule.nextRunAt?.getTime()).toBeGreaterThan(before.getTime());
    });

    test("list pagination and dispatch stay within a namespace", async () => {
      for (const id of ["a", "b", "c"])
        await ow.scheduleWorkflow(spec, input, { ...config, id });
      const first = await ow.schedules.list({ limit: 2 });
      expect(first.data.map((item) => item.id)).toEqual(["a", "b"]);
      const second = await ow.schedules.list({
        limit: 2,
        after: first.pagination.next ?? "",
      });
      expect(second.data.map((item) => item.id)).toEqual(["c"]);
      const previous = await ow.schedules.list({
        limit: 2,
        before: second.pagination.prev ?? "",
      });
      expect(previous.data.map((item) => item.id)).toEqual(["a", "b"]);
      const other = await options.setup();
      try {
        expect(
          await other.getWorkflowSchedule({ workflowScheduleId: "a" }),
        ).toBeNull();
        const otherPage = await other.listWorkflowSchedules({});
        expect(otherPage.data).toEqual([]);
        expect(
          await other.enqueueScheduledRuns({
            before: new Date(Date.now() + 86_400_000),
            limit: 100,
          }),
        ).toBe(0);
      } finally {
        await options.teardown(other);
      }
    });

    test("pausing or resuming a missing schedule fails", async () => {
      await expect(ow.schedules.pause("missing")).rejects.toThrow();
      await expect(ow.schedules.resume("missing")).rejects.toThrow();
    });
  });
}
