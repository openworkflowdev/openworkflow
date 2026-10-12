import { OpenWorkflow } from "../client/client.js";
import { BackendPostgres } from "./backend.js";
import { dropSchema, newPostgresMaxOne } from "./postgres.js";
import { TEST_POSTGRES_URL } from "./test-backend.testsuite.js";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";

describe("postgres scheduling", () => {
  test("dispatch skips a schedule being edited and uses the committed replacement", async () => {
    const schema = `schedule_edit_${randomUUID().replaceAll("-", "")}`;
    const backend = await BackendPostgres.connect(TEST_POSTGRES_URL, {
      schema,
    });
    const admin = newPostgresMaxOne(TEST_POSTGRES_URL);
    const ow = new OpenWorkflow({ backend });
    const dispatch = { before: new Date(Date.now() + 86_400_000), limit: 100 };
    try {
      await ow.scheduleWorkflow(
        { name: "report" },
        { value: "old" },
        { cron: "0 * * * *" },
      );
      await admin.begin(async (tx) => {
        await tx`UPDATE ${tx(schema)}."workflow_schedules"
          SET input=${tx.json({ value: "new" })} WHERE id='report'`;
        expect(await backend.enqueueScheduledRuns(dispatch)).toBe(0);
      });
      expect(await backend.enqueueScheduledRuns(dispatch)).toBe(1);
      const page = await backend.listWorkflowRuns({});
      expect(page.data[0]?.input).toEqual({ value: "new" });
    } finally {
      await backend.stop();
      await dropSchema(admin, schema);
      await admin.end();
    }
  });

  test("schedule dispatch rolls back run insertion and cursor advancement together", async () => {
    const schema = `schedule_atomic_${randomUUID().replaceAll("-", "")}`;
    const backend = await BackendPostgres.connect(TEST_POSTGRES_URL, {
      schema,
    });
    const admin = newPostgresMaxOne(TEST_POSTGRES_URL);
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
      await admin.unsafe(`CREATE FUNCTION "${schema}".reject_scheduled_run() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'injected insert failure'; END; $$;
      CREATE TRIGGER reject_scheduled_run BEFORE INSERT ON "${schema}".workflow_runs
        FOR EACH ROW EXECUTE FUNCTION "${schema}".reject_scheduled_run();`);
      await expect(backend.enqueueScheduledRuns(dispatch)).rejects.toThrow(
        "injected insert failure",
      );
      const rolledBackRuns = await backend.listWorkflowRuns({});
      expect(rolledBackRuns.data).toHaveLength(0);
      for (const schedule of schedules) {
        const unchanged = await ow.schedules.get(schedule.id);
        expect(unchanged?.nextRunAt).toEqual(schedule.nextRunAt);
      }
      await admin.unsafe(
        `DROP TRIGGER reject_scheduled_run ON "${schema}".workflow_runs`,
      );
      expect(await backend.enqueueScheduledRuns(dispatch)).toBe(2);
      expect(await backend.enqueueScheduledRuns(dispatch)).toBe(0);
      const committedRuns = await backend.listWorkflowRuns({});
      expect(committedRuns.data).toHaveLength(2);
    } finally {
      await backend.stop();
      await dropSchema(admin, schema);
      await admin.end();
    }
  });
});
