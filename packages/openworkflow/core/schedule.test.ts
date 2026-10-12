import { nextScheduleOccurrence, prepareWorkflowSchedule } from "./schedule.js";
import { defineWorkflowSpec } from "./workflow-definition.js";
import { describe, expect, test } from "vitest";

describe("schedule occurrence planning", () => {
  test("supports five fields and optional leading seconds, strictly after the cursor", () => {
    expect(
      nextScheduleOccurrence(
        { cron: "* * * * *", timezone: "UTC" },
        new Date("2026-01-01T00:00:00Z"),
      ),
    ).toEqual(new Date("2026-01-01T00:01:00Z"));
    expect(
      nextScheduleOccurrence(
        { cron: "*/5 * * * * *", timezone: "UTC" },
        new Date("2026-01-01T00:00:00Z"),
      ),
    ).toEqual(new Date("2026-01-01T00:00:05Z"));
  });
});

describe("schedule registration validation", () => {
  const spec = defineWorkflowSpec({ name: "report" });

  test("rejects versioned workflows instead of dispatching to an unregistered target", async () => {
    await expect(
      prepareWorkflowSchedule({ ...spec, version: "1" }, undefined, {
        cron: "0 * * * *",
      }),
    ).rejects.toThrow("unversioned workflow");
  });

  test("defaults to the exact workflow name and UTC and accepts weekday names", async () => {
    expect(
      await prepareWorkflowSchedule(spec, undefined, { cron: "0 9 * * THU" }),
    ).toMatchObject({
      id: "report",
      timezone: "UTC",
      input: null,
    });
  });

  test.each([
    "* * * *",
    "* * * * * * *",
    "H * * * *",
    "0 0 * * H#2",
    "0 0 31 2 *",
  ])("rejects invalid or nondeterministic cron %s", async (cron) => {
    await expect(
      prepareWorkflowSchedule(spec, null, { cron }),
    ).rejects.toThrow();
  });

  test("rejects invalid IDs and zones", async () => {
    await expect(
      prepareWorkflowSchedule(spec, null, { id: "", cron: "* * * * *" }),
    ).rejects.toThrow("ID");
    await expect(
      prepareWorkflowSchedule(spec, null, {
        timezone: "Invalid/Zone",
        cron: "* * * * *",
      }),
    ).rejects.toThrow();
  });

  test.each(["local", "system"])(
    "rejects the host-dependent timezone %s",
    async (timezone) => {
      await expect(
        prepareWorkflowSchedule(spec, null, {
          cron: "0 9 * * *",
          timezone,
        }),
      ).rejects.toThrow();
    },
  );

  test("rejects non-string options from JavaScript callers", async () => {
    await expect(
      prepareWorkflowSchedule(spec, null, {
        // @ts-expect-error Exercise untyped JavaScript callers.
        id: 123,
        cron: "* * * * *",
      }),
    ).rejects.toThrow("ID");
    await expect(
      prepareWorkflowSchedule(spec, null, {
        // @ts-expect-error Exercise untyped JavaScript callers.
        cron: 123,
      }),
    ).rejects.toThrow("cron");
    await expect(
      prepareWorkflowSchedule(spec, null, {
        cron: "* * * * *",
        // @ts-expect-error Exercise untyped JavaScript callers.
        timezone: 123,
      }),
    ).rejects.toThrow("timezone");
  });
});
