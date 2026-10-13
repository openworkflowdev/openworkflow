import { saveWorkflowSchedule } from "./schedules.server";
import { BackendSqlite } from "openworkflow/sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("dashboard schedule administration", () => {
  let backend: BackendSqlite;
  const data = {
    id: "daily-report",
    workflowName: "report",
    cron: "0 9 * * 1-5",
    timezone: "America/Chicago",
    input: '{"accountId":"acme"}',
    mode: "create" as const,
  };

  beforeEach(() => {
    backend = BackendSqlite.connect(":memory:");
  });
  afterEach(async () => {
    await backend.stop();
  });

  it("creates a validated schedule and updates it without resuming a paused schedule", async () => {
    const created = await saveWorkflowSchedule(backend, data);
    expect(created).toMatchObject({
      id: data.id,
      workflowName: data.workflowName,
      timezone: data.timezone,
      input: { accountId: "acme" },
    });
    expect(created.nextRunAt?.getTime()).toBeGreaterThan(Date.now());
    await backend.pauseWorkflowSchedule({
      workflowScheduleId: data.id,
      paused: true,
    });
    const edited = await saveWorkflowSchedule(backend, {
      ...data,
      mode: "edit",
      cron: "30 10 * * *",
      input: '{"accountId":"updated"}',
    });
    expect(edited.nextRunAt).toBeNull();
    expect(edited.createdAt).toEqual(created.createdAt);
    expect(edited.input).toEqual({ accountId: "updated" });
  });

  it("rejects invalid JSON without persisting it", async () => {
    await expect(
      saveWorkflowSchedule(backend, { ...data, input: "{invalid}" }),
    ).rejects.toThrow("Input must be valid JSON");
    expect(
      await backend.getWorkflowSchedule({ workflowScheduleId: data.id }),
    ).toBeNull();
  });

  it("does not overwrite an existing schedule through the create form", async () => {
    const created = await saveWorkflowSchedule(backend, data);
    await expect(
      saveWorkflowSchedule(backend, { ...data, input: "false" }),
    ).rejects.toThrow("already exists");
    expect(
      await backend.getWorkflowSchedule({ workflowScheduleId: data.id }),
    ).toEqual(created);
  });

  it("rejects an edit when the schedule is already deleted", async () => {
    await saveWorkflowSchedule(backend, data);
    await backend.deleteWorkflowSchedule({ workflowScheduleId: data.id });
    await expect(
      saveWorkflowSchedule(backend, { ...data, mode: "edit" }),
    ).rejects.toThrow("no longer exists");
  });
});
