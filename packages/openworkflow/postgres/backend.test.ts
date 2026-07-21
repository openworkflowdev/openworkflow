import { testBackend } from "../testing/backend.testsuite.js";
import { BackendPostgres } from "./backend.js";
import {
  DEFAULT_SCHEMA,
  DEFAULT_POSTGRES_URL,
  dropSchema,
  newPostgresMaxOne,
  type Postgres,
} from "./postgres.js";
import { randomUUID } from "node:crypto";
import { describe, expect, test, vi } from "vitest";

interface StepMutationContext {
  backend: BackendPostgres;
  workflowRunId: string;
  stepAttemptId: string;
  workerId: string;
  childWorkflowRunNamespaceId: string;
  childWorkflowRunId: string;
}

interface StepMutationCase {
  name: string;
  mutate: (context: StepMutationContext) => Promise<unknown>;
}

const STEP_MUTATION_CASES: StepMutationCase[] = [
  {
    name: "child-link update",
    mutate: async (context) =>
      await context.backend.setStepAttemptChildWorkflowRun({
        workflowRunId: context.workflowRunId,
        stepAttemptId: context.stepAttemptId,
        workerId: context.workerId,
        childWorkflowRunNamespaceId: context.childWorkflowRunNamespaceId,
        childWorkflowRunId: context.childWorkflowRunId,
      }),
  },
  {
    name: "completion",
    mutate: async (context) =>
      await context.backend.completeStepAttempt({
        workflowRunId: context.workflowRunId,
        stepAttemptId: context.stepAttemptId,
        workerId: context.workerId,
        output: { stale: true },
      }),
  },
  {
    name: "failure",
    mutate: async (context) =>
      await context.backend.failStepAttempt({
        workflowRunId: context.workflowRunId,
        stepAttemptId: context.stepAttemptId,
        workerId: context.workerId,
        error: { message: "stale failure" },
      }),
  },
];

async function waitForPostgresBackendLock(
  pg: Postgres,
  backendPid: number,
): Promise<void> {
  const timeoutAt = Date.now() + 2000;

  while (Date.now() < timeoutAt) {
    const [activity] = await pg<{ waitEventType: string | null }[]>`
      SELECT "wait_event_type" AS "waitEventType"
      FROM "pg_stat_activity"
      WHERE "pid" = ${backendPid}
    `;
    if (activity?.waitEventType === "Lock") return;

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error("Timed out waiting for Postgres backend lock");
}

test("it is a test file (workaround for sonarjs/no-empty-test-file linter)", () => {
  expect(testBackend).toBeTypeOf("function");
});

testBackend({
  setup: async () => {
    return await BackendPostgres.connect(DEFAULT_POSTGRES_URL, {
      namespaceId: randomUUID(),
    });
  },
  teardown: async (backend) => {
    await backend.stop();
  },
});

describe("BackendPostgres.connect errors", () => {
  test("returns a helpful error for invalid connection URLs", async () => {
    await expect(BackendPostgres.connect("not-a-valid-url")).rejects.toThrow(
      /Postgres backend failed to connect.*postgresql:\/\/user:pass@host:port\/db.*:/,
    );
  });

  test("throws a clear error for invalid schema names", async () => {
    await expect(
      BackendPostgres.connect(DEFAULT_POSTGRES_URL, {
        schema: "invalid-schema",
      }),
    ).rejects.toThrow(/Invalid schema name/);
  });

  test("throws for schema names longer than 63 bytes", async () => {
    await expect(
      BackendPostgres.connect(DEFAULT_POSTGRES_URL, {
        schema: "a".repeat(64),
      }),
    ).rejects.toThrow(/at most 63 bytes/i);
  });
});

describe("BackendPostgres.fromPool", () => {
  test("uses an existing pool with the provided namespace", async () => {
    const namespaceId = randomUUID();
    const pg = newPostgresMaxOne(DEFAULT_POSTGRES_URL);
    const backend = BackendPostgres.fromPool(pg, {
      namespaceId,
    });

    try {
      const workflowRun = await backend.createWorkflowRun({
        workflowName: "from-pool-namespace",
        version: null,
        idempotencyKey: null,
        input: null,
        config: {},
        context: null,
        parentStepAttemptNamespaceId: null,
        parentStepAttemptId: null,
        availableAt: null,
        deadlineAt: null,
      });

      expect(workflowRun.namespaceId).toBe(namespaceId);
    } finally {
      await pg.end();
    }
  });

  test("does not run migrations automatically", async () => {
    const schema = `test_schema_${randomUUID().replaceAll("-", "_")}`;
    const pg = newPostgresMaxOne(DEFAULT_POSTGRES_URL);
    const backend = BackendPostgres.fromPool(pg, {
      namespaceId: randomUUID(),
      schema,
    });

    try {
      await expect(
        backend.createWorkflowRun({
          workflowName: "from-pool-no-migrations",
          version: null,
          idempotencyKey: null,
          input: null,
          config: {},
          context: null,
          parentStepAttemptNamespaceId: null,
          parentStepAttemptId: null,
          availableAt: null,
          deadlineAt: null,
        }),
      ).rejects.toThrow(/does not exist/i);
    } finally {
      await dropSchema(pg, schema);
      await pg.end();
    }
  });

  test("throws a clear error for invalid schema names", async () => {
    const pg = newPostgresMaxOne(DEFAULT_POSTGRES_URL);

    try {
      expect(() =>
        BackendPostgres.fromPool(pg, {
          schema: "invalid-schema",
        }),
      ).toThrow(/Invalid schema name/);
    } finally {
      await pg.end();
    }
  });
});

describe("BackendPostgres idempotency advisory locks", () => {
  test("uses a transaction-scoped advisory lock", async () => {
    const queries: string[] = [];
    const pg = newPostgresMaxOne(DEFAULT_POSTGRES_URL, {
      debug: (_connection, query) => {
        queries.push(query);
      },
    });
    const backend = BackendPostgres.fromPool(pg, {
      namespaceId: randomUUID(),
    });

    try {
      await backend.createWorkflowRun({
        workflowName: randomUUID(),
        version: null,
        idempotencyKey: randomUUID(),
        input: null,
        config: {},
        context: null,
        parentStepAttemptNamespaceId: null,
        parentStepAttemptId: null,
        availableAt: null,
        deadlineAt: null,
      });

      expect(queries).toContain("BEGIN ISOLATION LEVEL READ COMMITTED");
      expect(queries).toContain("COMMIT");
      expect(
        queries.some((query) => query.includes("pg_advisory_xact_lock")),
      ).toBe(true);
      expect(
        queries.some((query) => query.includes("pg_advisory_unlock")),
      ).toBe(false);
    } finally {
      await pg.end();
    }
  });

  test("rolls back and releases the reserved connection after an insert error", async () => {
    const queries: string[] = [];
    const pg = newPostgresMaxOne(DEFAULT_POSTGRES_URL, {
      debug: (_connection, query) => {
        queries.push(query);
      },
    });
    const backend = BackendPostgres.fromPool(pg, {
      namespaceId: randomUUID(),
    });

    try {
      await expect(
        backend.createWorkflowRun({
          workflowName: randomUUID(),
          version: null,
          idempotencyKey: randomUUID(),
          input: null,
          config: {},
          context: null,
          parentStepAttemptNamespaceId: randomUUID(),
          parentStepAttemptId: randomUUID(),
          availableAt: null,
          deadlineAt: null,
        }),
      ).rejects.toThrow(/foreign key constraint/i);

      await expect(
        backend.createWorkflowRun({
          workflowName: randomUUID(),
          version: null,
          idempotencyKey: randomUUID(),
          input: null,
          config: {},
          context: null,
          parentStepAttemptNamespaceId: null,
          parentStepAttemptId: null,
          availableAt: null,
          deadlineAt: null,
        }),
      ).resolves.toMatchObject({ status: "pending" });

      expect(queries).toContain("ROLLBACK");
    } finally {
      await pg.end();
    }
  });

  test("does not release a reserved connection after a connection error", async () => {
    const connectionError = Object.assign(new Error("connection closed"), {
      errno: "CONNECTION_CLOSED",
    });
    const reserved = {
      unsafe: vi.fn((query: string) =>
        query.startsWith("SELECT")
          ? Promise.reject(connectionError)
          : Promise.resolve([]),
      ),
      release: vi.fn(),
    };
    const pg = {
      reserve: () => Promise.resolve(reserved),
    } as unknown as Postgres;
    const backend = BackendPostgres.fromPool(pg);

    await expect(
      backend.createWorkflowRun({
        workflowName: randomUUID(),
        version: null,
        idempotencyKey: randomUUID(),
        input: null,
        config: {},
        context: null,
        parentStepAttemptNamespaceId: null,
        parentStepAttemptId: null,
        availableAt: null,
        deadlineAt: null,
      }),
    ).rejects.toBe(connectionError);

    expect(reserved.unsafe).not.toHaveBeenCalledWith("ROLLBACK");
    expect(reserved.release).not.toHaveBeenCalled();
  });

  test("does not release a reserved connection after a rollback error", async () => {
    const transactionError = new Error("transaction failed");
    const rollbackError = new Error("rollback failed");
    const reserved = {
      unsafe: vi.fn((query: string) => {
        if (query.startsWith("SELECT")) return Promise.reject(transactionError);
        if (query === "ROLLBACK") return Promise.reject(rollbackError);
        return Promise.resolve([]);
      }),
      release: vi.fn(),
    };
    const pg = {
      reserve: () => Promise.resolve(reserved),
    } as unknown as Postgres;
    const backend = BackendPostgres.fromPool(pg);

    await expect(
      backend.createWorkflowRun({
        workflowName: randomUUID(),
        version: null,
        idempotencyKey: randomUUID(),
        input: null,
        config: {},
        context: null,
        parentStepAttemptNamespaceId: null,
        parentStepAttemptId: null,
        availableAt: null,
        deadlineAt: null,
      }),
    ).rejects.toBe(transactionError);

    expect(reserved.unsafe).toHaveBeenCalledWith("ROLLBACK");
    expect(reserved.release).not.toHaveBeenCalled();
  });
});

describe("BackendPostgres step-attempt lease fencing", () => {
  test.each(STEP_MUTATION_CASES)(
    "$name waits for lease transfers and rejects stale workers",
    async ({ mutate }) => {
      const namespaceId = randomUUID();
      const originalWorkerId = randomUUID();
      const nextWorkerId = randomUUID();
      const backendPool = newPostgresMaxOne(DEFAULT_POSTGRES_URL);
      const leaseTransferPool = newPostgresMaxOne(DEFAULT_POSTGRES_URL);
      const observerPool = newPostgresMaxOne(DEFAULT_POSTGRES_URL);
      const backend = BackendPostgres.fromPool(backendPool, { namespaceId });
      const leaseTransfer = await leaseTransferPool.reserve();
      let leaseTransferOpen = false;
      let mutation: Promise<unknown> | undefined;

      try {
        const workflowRun = await backend.createWorkflowRun({
          workflowName: randomUUID(),
          version: null,
          idempotencyKey: null,
          input: null,
          config: {},
          context: null,
          parentStepAttemptNamespaceId: null,
          parentStepAttemptId: null,
          availableAt: null,
          deadlineAt: null,
        });
        const claimed = await backend.claimWorkflowRun({
          workerId: originalWorkerId,
          leaseDurationMs: 60_000,
        });
        expect(claimed?.id).toBe(workflowRun.id);

        const stepAttempt = await backend.createStepAttempt({
          workflowRunId: workflowRun.id,
          workerId: originalWorkerId,
          stepName: randomUUID(),
          kind: "workflow",
          config: {},
          context: null,
        });
        const childWorkflowRun = await backend.createWorkflowRun({
          workflowName: randomUUID(),
          version: null,
          idempotencyKey: null,
          input: null,
          config: {},
          context: null,
          parentStepAttemptNamespaceId: null,
          parentStepAttemptId: null,
          availableAt: null,
          deadlineAt: null,
        });
        const [backendConnection] = await backendPool<{ pid: number }[]>`
          SELECT pg_backend_pid() AS "pid"
        `;
        if (!backendConnection) {
          throw new Error("Expected Postgres backend connection pid");
        }

        const workflowRunsTable = leaseTransfer`${leaseTransfer(DEFAULT_SCHEMA)}.${leaseTransfer("workflow_runs")}`;
        await leaseTransfer.unsafe("BEGIN");
        leaseTransferOpen = true;
        const transferred = await leaseTransfer`
          UPDATE ${workflowRunsTable}
          SET
            "worker_id" = ${nextWorkerId},
            "available_at" = NOW() + INTERVAL '1 minute',
            "updated_at" = NOW()
          WHERE "namespace_id" = ${namespaceId}
            AND "id" = ${workflowRun.id}
          RETURNING "id"
        `;
        expect(transferred).toHaveLength(1);

        const mutationPromise = mutate({
          backend,
          workflowRunId: workflowRun.id,
          stepAttemptId: stepAttempt.id,
          workerId: originalWorkerId,
          childWorkflowRunNamespaceId: childWorkflowRun.namespaceId,
          childWorkflowRunId: childWorkflowRun.id,
        });
        mutation = mutationPromise;

        await waitForPostgresBackendLock(observerPool, backendConnection.pid);
        await leaseTransfer.unsafe("COMMIT");
        leaseTransferOpen = false;

        await expect(mutationPromise).rejects.toThrow();

        const persisted = await backend.getStepAttempt({
          stepAttemptId: stepAttempt.id,
        });
        expect(persisted).toMatchObject({
          status: "running",
          output: null,
          error: null,
          childWorkflowRunNamespaceId: null,
          childWorkflowRunId: null,
        });
      } finally {
        if (leaseTransferOpen) {
          await leaseTransfer.unsafe("ROLLBACK");
        }
        await mutation?.catch(() => null);
        leaseTransfer.release();
        await Promise.all([
          backendPool.end(),
          leaseTransferPool.end(),
          observerPool.end(),
        ]);
      }
    },
  );
});

describe("BackendPostgres schema option", () => {
  test("stores workflow data in the configured schema", async () => {
    const schema = `test_schema_${randomUUID().replaceAll("-", "_")}`;
    const namespaceId = randomUUID();
    const backend = await BackendPostgres.connect(DEFAULT_POSTGRES_URL, {
      namespaceId,
      schema,
    });

    try {
      const workflowRun = await backend.createWorkflowRun({
        workflowName: "schema-test",
        version: null,
        idempotencyKey: null,
        input: null,
        config: {},
        context: null,
        parentStepAttemptNamespaceId: null,
        parentStepAttemptId: null,
        availableAt: null,
        deadlineAt: null,
      });

      const pg = newPostgresMaxOne(DEFAULT_POSTGRES_URL);
      try {
        const workflowRunsTable = pg`${pg(schema)}.${pg("workflow_runs")}`;

        const [record] = await pg<{ id: string }[]>`
          SELECT "id"
          FROM ${workflowRunsTable}
          WHERE "namespace_id" = ${namespaceId}
            AND "id" = ${workflowRun.id}
          LIMIT 1
        `;

        expect(record?.id).toBe(workflowRun.id);
      } finally {
        await pg.end();
      }
    } finally {
      await backend.stop();

      const pg = newPostgresMaxOne(DEFAULT_POSTGRES_URL);
      await dropSchema(pg, schema);
      await pg.end();
    }
  });

  test("reschedules workflow runs in the configured schema", async () => {
    const schema = `test_schema_${randomUUID().replaceAll("-", "_")}`;
    const namespaceId = randomUUID();
    const workerId = randomUUID();
    const backend = await BackendPostgres.connect(DEFAULT_POSTGRES_URL, {
      namespaceId,
      schema,
    });

    try {
      const workflowRun = await backend.createWorkflowRun({
        workflowName: "schema-reschedule-test",
        version: null,
        idempotencyKey: null,
        input: null,
        config: {},
        context: null,
        parentStepAttemptNamespaceId: null,
        parentStepAttemptId: null,
        availableAt: null,
        deadlineAt: null,
      });

      const claimed = await backend.claimWorkflowRun({
        workerId,
        leaseDurationMs: 60_000,
      });

      expect(claimed?.id).toBe(workflowRun.id);

      const availableAt = new Date(Date.now() + 60_000);
      const rescheduled =
        await backend.rescheduleWorkflowRunAfterFailedStepAttempt({
          workflowRunId: workflowRun.id,
          workerId,
          availableAt,
          error: { message: "step failed" },
        });

      expect(rescheduled.id).toBe(workflowRun.id);
      expect(rescheduled.status).toBe("pending");
      expect(rescheduled.workerId).toBeNull();

      const pg = newPostgresMaxOne(DEFAULT_POSTGRES_URL);
      try {
        const workflowRunsTable = pg`${pg(schema)}.${pg("workflow_runs")}`;

        const [record] = await pg<
          {
            id: string;
            status: string;
          }[]
        >`
          SELECT "id", "status"
          FROM ${workflowRunsTable}
          WHERE "namespace_id" = ${namespaceId}
            AND "id" = ${workflowRun.id}
          LIMIT 1
        `;

        expect(record?.id).toBe(workflowRun.id);
        expect(record?.status).toBe("pending");
      } finally {
        await pg.end();
      }
    } finally {
      await backend.stop();

      const pg = newPostgresMaxOne(DEFAULT_POSTGRES_URL);
      await dropSchema(pg, schema);
      await pg.end();
    }
  });
});

describe("BackendPostgres JSON key preservation", () => {
  test("preserves uppercase snake case keys in workflow run input", async () => {
    const namespaceId = randomUUID();
    const backend = await BackendPostgres.connect(DEFAULT_POSTGRES_URL, {
      namespaceId,
    });

    // https://github.com/openworkflowdev/openworkflow/issues/367
    const input = {
      env: {
        OPENAI_MODEL: "gpt-5.3-codex",
        OPENAI_BASE_URL: "http://127.0.0.1:8090/...",
        OPENAI_REASONING_EFFORT: "medium",
      },
    };
    const transformedModelKey = "OPENAI_MODEL".replaceAll("_", "");
    const transformedBaseUrlKey = "OPENAI_BASE_URL".replaceAll("_", "");
    const transformedReasoningEffortKey = "OPENAI_REASONING_EFFORT".replaceAll(
      "_",
      "",
    );

    try {
      const workflowRun = await backend.createWorkflowRun({
        workflowName: "json-key-preservation",
        version: null,
        idempotencyKey: null,
        input,
        config: {},
        context: null,
        parentStepAttemptNamespaceId: null,
        parentStepAttemptId: null,
        availableAt: null,
        deadlineAt: null,
      });

      if (
        !workflowRun.input ||
        typeof workflowRun.input !== "object" ||
        Array.isArray(workflowRun.input)
      ) {
        throw new Error("Expected workflow run input object");
      }

      const createEnv = (workflowRun.input as { env?: Record<string, string> })
        .env;
      if (!createEnv) throw new Error("Expected workflow run input env");
      expect(createEnv["OPENAI_MODEL"]).toBe(input.env.OPENAI_MODEL);
      expect(createEnv["OPENAI_BASE_URL"]).toBe(input.env.OPENAI_BASE_URL);
      expect(createEnv["OPENAI_REASONING_EFFORT"]).toBe(
        input.env.OPENAI_REASONING_EFFORT,
      );
      expect(createEnv[transformedModelKey]).toBeUndefined();
      expect(createEnv[transformedBaseUrlKey]).toBeUndefined();
      expect(createEnv[transformedReasoningEffortKey]).toBeUndefined();

      const pg = newPostgresMaxOne(DEFAULT_POSTGRES_URL);
      try {
        const workflowRunsTable = pg`${pg(DEFAULT_SCHEMA)}.${pg("workflow_runs")}`;
        const [record] = await pg<
          {
            input: {
              env?: Record<string, string>;
            };
          }[]
        >`
          SELECT "input"
          FROM ${workflowRunsTable}
          WHERE "namespace_id" = ${namespaceId}
            AND "id" = ${workflowRun.id}
          LIMIT 1
        `;

        const persistedEnv = record?.input.env;
        if (!persistedEnv) throw new Error("Expected persisted workflow input");
        expect(persistedEnv["OPENAI_MODEL"]).toBe(input.env.OPENAI_MODEL);
        expect(persistedEnv["OPENAI_BASE_URL"]).toBe(input.env.OPENAI_BASE_URL);
        expect(persistedEnv["OPENAI_REASONING_EFFORT"]).toBe(
          input.env.OPENAI_REASONING_EFFORT,
        );
        expect(persistedEnv[transformedModelKey]).toBeUndefined();
        expect(persistedEnv[transformedBaseUrlKey]).toBeUndefined();
        expect(persistedEnv[transformedReasoningEffortKey]).toBeUndefined();
      } finally {
        await pg.end();
      }
    } finally {
      await backend.stop();
    }
  });
});

describe("BackendPostgres cancel fallback", () => {
  test("throws generic cancel error for non-standard workflow status", async () => {
    const backend = await BackendPostgres.connect(DEFAULT_POSTGRES_URL, {
      namespaceId: randomUUID(),
    });

    try {
      const run = await backend.createWorkflowRun({
        workflowName: "cancel-non-standard-status",
        version: null,
        idempotencyKey: null,
        input: null,
        config: {},
        context: null,
        parentStepAttemptNamespaceId: null,
        parentStepAttemptId: null,
        availableAt: null,
        deadlineAt: null,
      });

      const pg = newPostgresMaxOne(DEFAULT_POSTGRES_URL);
      try {
        const workflowRunsTable = pg`${pg(DEFAULT_SCHEMA)}.${pg("workflow_runs")}`;

        await pg`
          UPDATE ${workflowRunsTable}
          SET "status" = 'paused'
          WHERE "namespace_id" = ${run.namespaceId}
            AND "id" = ${run.id}
        `;
      } finally {
        await pg.end();
      }

      await expect(
        backend.cancelWorkflowRun({
          workflowRunId: run.id,
        }),
      ).rejects.toThrow("Failed to cancel workflow run");
    } finally {
      await backend.stop();
    }
  });
});

describe("BackendPostgres legacy sleeping compatibility", () => {
  test("claims workflow runs persisted with legacy sleeping status", async () => {
    const namespaceId = randomUUID();
    const backend = await BackendPostgres.connect(DEFAULT_POSTGRES_URL, {
      namespaceId,
    });

    try {
      const run = await backend.createWorkflowRun({
        workflowName: "legacy-sleeping-claim",
        version: null,
        idempotencyKey: null,
        input: null,
        config: {},
        context: null,
        parentStepAttemptNamespaceId: null,
        parentStepAttemptId: null,
        availableAt: null,
        deadlineAt: null,
      });

      const pg = newPostgresMaxOne(DEFAULT_POSTGRES_URL);
      try {
        const workflowRunsTable = pg`${pg(DEFAULT_SCHEMA)}.${pg("workflow_runs")}`;

        await pg`
          UPDATE ${workflowRunsTable}
          SET
            "status" = 'sleeping',
            "worker_id" = NULL,
            "available_at" = NOW() - INTERVAL '1 second',
            "updated_at" = NOW()
          WHERE "namespace_id" = ${namespaceId}
            AND "id" = ${run.id}
        `;
      } finally {
        await pg.end();
      }

      const workerId = randomUUID();
      const claimed = await backend.claimWorkflowRun({
        workerId,
        leaseDurationMs: 60_000,
      });

      expect(claimed?.id).toBe(run.id);
      expect(claimed?.status).toBe("running");
      expect(claimed?.workerId).toBe(workerId);
    } finally {
      await backend.stop();
    }
  });
});

describe("BackendPostgres workflow wake-up reconciliation", () => {
  test("wakes parked parent immediately when child already finished", async () => {
    const backend = await BackendPostgres.connect(DEFAULT_POSTGRES_URL, {
      namespaceId: randomUUID(),
    });

    try {
      const parent = await backend.createWorkflowRun({
        workflowName: "workflow-parent-reconcile",
        version: null,
        idempotencyKey: null,
        input: null,
        config: {},
        context: null,
        parentStepAttemptNamespaceId: null,
        parentStepAttemptId: null,
        availableAt: null,
        deadlineAt: null,
      });

      const parentWorkerId = randomUUID();
      const claimedParent = await backend.claimWorkflowRun({
        workerId: parentWorkerId,
        leaseDurationMs: 60_000,
      });
      expect(claimedParent?.id).toBe(parent.id);
      if (!claimedParent) {
        throw new Error("Expected parent workflow run to be claimed");
      }

      const workflowAttempt = await backend.createStepAttempt({
        workflowRunId: parent.id,
        workerId: parentWorkerId,
        stepName: "workflow-child",
        kind: "workflow",
        config: {},
        context: null,
      });

      const child = await backend.createWorkflowRun({
        workflowName: "workflow-child-reconcile",
        version: null,
        idempotencyKey: null,
        input: null,
        config: {},
        context: null,
        parentStepAttemptNamespaceId: workflowAttempt.namespaceId,
        parentStepAttemptId: workflowAttempt.id,
        availableAt: null,
        deadlineAt: null,
      });

      await backend.setStepAttemptChildWorkflowRun({
        workflowRunId: parent.id,
        stepAttemptId: workflowAttempt.id,
        workerId: parentWorkerId,
        childWorkflowRunNamespaceId: child.namespaceId,
        childWorkflowRunId: child.id,
      });

      const childWorkerId = randomUUID();
      const claimedChild = await backend.claimWorkflowRun({
        workerId: childWorkerId,
        leaseDurationMs: 60_000,
      });
      expect(claimedChild?.id).toBe(child.id);
      if (!claimedChild) {
        throw new Error("Expected child workflow run to be claimed");
      }

      await backend.completeWorkflowRun({
        workflowRunId: child.id,
        workerId: childWorkerId,
        output: { ok: true },
      });

      const sleepTarget = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const parkedParent = await backend.sleepWorkflowRun({
        workflowRunId: parent.id,
        workerId: parentWorkerId,
        availableAt: sleepTarget,
      });

      expect(parkedParent.status).toBe("running");
      expect(parkedParent.workerId).toBeNull();
      if (!parkedParent.availableAt) {
        throw new Error("Expected parked parent availableAt");
      }
      expect(parkedParent.availableAt.getTime()).toBeLessThan(
        Date.now() + 1000,
      );
    } finally {
      await backend.stop();
    }
  });

  test("does not wake parked parent when workflow step is no longer running", async () => {
    const backend = await BackendPostgres.connect(DEFAULT_POSTGRES_URL, {
      namespaceId: randomUUID(),
    });

    try {
      const parent = await backend.createWorkflowRun({
        workflowName: "workflow-parent-no-wake-after-failed-workflow",
        version: null,
        idempotencyKey: null,
        input: null,
        config: {},
        context: null,
        parentStepAttemptNamespaceId: null,
        parentStepAttemptId: null,
        availableAt: null,
        deadlineAt: null,
      });

      const parentWorkerId = randomUUID();
      const claimedParent = await backend.claimWorkflowRun({
        workerId: parentWorkerId,
        leaseDurationMs: 60_000,
      });
      expect(claimedParent?.id).toBe(parent.id);
      if (!claimedParent) {
        throw new Error("Expected parent workflow run to be claimed");
      }

      const workflowAttempt = await backend.createStepAttempt({
        workflowRunId: parent.id,
        workerId: parentWorkerId,
        stepName: "workflow-child",
        kind: "workflow",
        config: {},
        context: null,
      });

      const child = await backend.createWorkflowRun({
        workflowName: "workflow-child-no-wake-after-failed-workflow",
        version: null,
        idempotencyKey: null,
        input: null,
        config: {},
        context: null,
        parentStepAttemptNamespaceId: workflowAttempt.namespaceId,
        parentStepAttemptId: workflowAttempt.id,
        availableAt: null,
        deadlineAt: null,
      });

      await backend.setStepAttemptChildWorkflowRun({
        workflowRunId: parent.id,
        stepAttemptId: workflowAttempt.id,
        workerId: parentWorkerId,
        childWorkflowRunNamespaceId: child.namespaceId,
        childWorkflowRunId: child.id,
      });

      await backend.failStepAttempt({
        workflowRunId: parent.id,
        stepAttemptId: workflowAttempt.id,
        workerId: parentWorkerId,
        error: { message: "workflow failed in parent" },
      });

      const sleepTarget = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const parkedParent = await backend.sleepWorkflowRun({
        workflowRunId: parent.id,
        workerId: parentWorkerId,
        availableAt: sleepTarget,
      });

      expect(parkedParent.status).toBe("running");
      expect(parkedParent.workerId).toBeNull();

      const childWorkerId = randomUUID();
      const claimedChild = await backend.claimWorkflowRun({
        workerId: childWorkerId,
        leaseDurationMs: 60_000,
      });
      expect(claimedChild?.id).toBe(child.id);
      if (!claimedChild) {
        throw new Error("Expected child workflow run to be claimed");
      }

      await backend.completeWorkflowRun({
        workflowRunId: child.id,
        workerId: childWorkerId,
        output: { ok: true },
      });

      const parentAfterChild = await backend.getWorkflowRun({
        workflowRunId: parent.id,
      });
      expect(parentAfterChild?.status).toBe("running");
      expect(parentAfterChild?.workerId).toBeNull();
      if (!parentAfterChild?.availableAt) {
        throw new Error("Expected parent availableAt after child completion");
      }
      expect(parentAfterChild.availableAt.getTime()).toBeGreaterThan(
        Date.now() + 30 * 60 * 1000,
      );
    } finally {
      await backend.stop();
    }
  });

  test("sleepWorkflowRun overwrites stale due availableAt with new resume time", async () => {
    const namespaceId = randomUUID();
    const backend = await BackendPostgres.connect(DEFAULT_POSTGRES_URL, {
      namespaceId,
    });

    try {
      const run = await backend.createWorkflowRun({
        workflowName: "sleep-overwrite-stale-available-at",
        version: null,
        idempotencyKey: null,
        input: null,
        config: {},
        context: null,
        parentStepAttemptNamespaceId: null,
        parentStepAttemptId: null,
        availableAt: null,
        deadlineAt: null,
      });

      const workerId = randomUUID();
      const claimed = await backend.claimWorkflowRun({
        workerId,
        leaseDurationMs: 60_000,
      });
      expect(claimed?.id).toBe(run.id);
      if (!claimed) {
        throw new Error("Expected workflow run to be claimed");
      }

      const pg = newPostgresMaxOne(DEFAULT_POSTGRES_URL);
      try {
        const workflowRunsTable = pg`${pg(DEFAULT_SCHEMA)}.${pg("workflow_runs")}`;
        await pg`
          UPDATE ${workflowRunsTable}
          SET
            "available_at" = NOW() - INTERVAL '1 second',
            "updated_at" = NOW()
          WHERE "namespace_id" = ${namespaceId}
            AND "id" = ${run.id}
        `;
      } finally {
        await pg.end();
      }

      const sleepTarget = new Date(Date.now() + 60 * 60 * 1000);
      const parked = await backend.sleepWorkflowRun({
        workflowRunId: run.id,
        workerId,
        availableAt: sleepTarget,
      });

      expect(parked.status).toBe("running");
      expect(parked.workerId).toBeNull();
      if (!parked.availableAt) {
        throw new Error("Expected parked workflow availableAt");
      }
      expect(parked.availableAt.getTime()).toBeGreaterThan(
        Date.now() + 30 * 60 * 1000,
      );
    } finally {
      await backend.stop();
    }
  });
});
