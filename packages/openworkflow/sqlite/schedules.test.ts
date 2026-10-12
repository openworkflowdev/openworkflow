import { OpenWorkflow } from "../client/client.js";
import { BackendSqlite } from "./backend.js";
import { describe, expect, test } from "vitest";

describe("sqlite scheduling", () => {
  test("schedule dispatch rolls back the whole batch if inserting a workflow run fails", async () => {
    const backend = BackendSqlite.connect(":memory:");
    const ow = new OpenWorkflow({ backend });
    try {
      const schedules = await Promise.all(
        ["a", "b"].map((id) =>
          ow.scheduleWorkflow({ name: "report" }, null, {
            id,
            cron: "0 * * * *",
          }),
        ),
      );
      const dispatch = {
        before: new Date(Date.now() + 86_400_000),
        limit: 100,
      };
      backend["db"].exec(`CREATE TRIGGER reject_scheduled_run
        BEFORE INSERT ON workflow_runs WHEN NEW.workflow_schedule_id='b'
        BEGIN SELECT RAISE(ABORT, 'injected insert failure'); END;`);
      await expect(backend.enqueueScheduledRuns(dispatch)).rejects.toThrow(
        "injected insert failure",
      );
      const rolledBackRuns = await backend.listWorkflowRuns({});
      expect(rolledBackRuns.data).toHaveLength(0);
      const schedulePage = await ow.schedules.list();
      expect(schedulePage.data.map((schedule) => schedule.nextRunAt)).toEqual(
        schedules.map((schedule) => schedule.nextRunAt),
      );
      backend["db"].exec("DROP TRIGGER reject_scheduled_run");
      expect(await backend.enqueueScheduledRuns(dispatch)).toBe(2);
      expect(await backend.enqueueScheduledRuns(dispatch)).toBe(0);
      const committedRuns = await backend.listWorkflowRuns({});
      expect(committedRuns.data).toHaveLength(2);
    } finally {
      await backend.stop();
    }
  });
});
