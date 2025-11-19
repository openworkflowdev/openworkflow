import {
  newPostgres,
  newPostgresMaxOne,
  Postgres,
  migrate,
  DEFAULT_SCHEMA,
} from "./postgres.js";
import {
  DEFAULT_NAMESPACE_ID,
  Backend,
  CancelWorkflowRunParams,
  ClaimWorkflowRunParams,
  CreateStepAttemptParams,
  CreateWorkflowRunParams,
  GetStepAttemptParams,
  GetWorkflowRunParams,
  ExtendWorkflowRunLeaseParams,
  ListStepAttemptsParams,
  ListWorkflowRunsParams,
  PaginatedResponse,
  FailStepAttemptParams,
  CompleteStepAttemptParams,
  FailWorkflowRunParams,
  CompleteWorkflowRunParams,
  SleepWorkflowRunParams,
  StepAttempt,
  WorkflowRun,
  DEFAULT_RETRY_POLICY,
  JsonValue,
} from "openworkflow";

export const DEFAULT_PAGINATION_PAGE_SIZE = 100;

interface BackendPostgresOptions {
  namespaceId?: string;
  runMigrations?: boolean;
}

/**
 * Manages a connection to a Postgres database for workflow operations.
 */
export class BackendPostgres implements Backend {
  private pg: Postgres;
  private namespaceId: string;

  private constructor(pg: Postgres, namespaceId: string) {
    this.pg = pg;
    this.namespaceId = namespaceId;
  }

  /**
   * Create and initialize a new BackendPostgres instance. This will
   * automatically run migrations on startup unless `runMigrations` is set to
   * false.
   */
  static async connect(
    url: string,
    options?: BackendPostgresOptions,
  ): Promise<BackendPostgres> {
    const { namespaceId, runMigrations } = {
      namespaceId: DEFAULT_NAMESPACE_ID,
      runMigrations: true,
      ...options,
    };

    if (runMigrations) {
      const pgForMigrate = newPostgresMaxOne(url);
      await migrate(pgForMigrate, DEFAULT_SCHEMA);
      await pgForMigrate.end();
    }

    const pg = newPostgres(url);
    return new BackendPostgres(pg, namespaceId);
  }

  async stop(): Promise<void> {
    await this.pg.end();
  }

  async createWorkflowRun(
    params: CreateWorkflowRunParams,
  ): Promise<WorkflowRun> {
    const [workflowRun] = await this.pg<WorkflowRun[]>`
      INSERT INTO "openworkflow"."workflow_runs" (
        "namespace_id",
        "id",
        "workflow_name",
        "version",
        "status",
        "idempotency_key",
        "config",
        "context",
        "input",
        "attempts",
        "available_at",
        "deadline_at",
        "created_at",
        "updated_at"
      )
      VALUES (
        ${this.namespaceId},
        gen_random_uuid(),
        ${params.workflowName},
        ${params.version},
        'pending',
        ${params.idempotencyKey},
        ${this.pg.json(params.config)},
        ${this.pg.json(params.context)},
        ${this.pg.json(params.input)},
        0,
        ${sqlDateDefaultNow(this.pg, params.availableAt)},
        ${params.deadlineAt},
        date_trunc('milliseconds', NOW()),
        NOW()
      )
      RETURNING *
    `;

    if (!workflowRun) throw new Error("Failed to create workflow run");

    return workflowRun;
  }

  async getWorkflowRun(
    params: GetWorkflowRunParams,
  ): Promise<WorkflowRun | null> {
    const [workflowRun] = await this.pg<WorkflowRun[]>`
      SELECT *
      FROM "openworkflow"."workflow_runs"
      WHERE "namespace_id" = ${this.namespaceId}
      AND "id" = ${params.workflowRunId}
      LIMIT 1
    `;

    return workflowRun ?? null;
  }

  async listWorkflowRuns(
    params: ListWorkflowRunsParams,
  ): Promise<PaginatedResponse<WorkflowRun>> {
    const limit = params.limit ?? DEFAULT_PAGINATION_PAGE_SIZE;
    const { after, before } = params;

    let cursor: Cursor | null = null;
    if (after) {
      cursor = decodeCursor(after);
    } else if (before) {
      cursor = decodeCursor(before);
    }

    const whereClause = this.buildListWorkflowRunsWhere(params, cursor);
    const order = before
      ? this.pg`ORDER BY "created_at" DESC, "id" DESC`
      : this.pg`ORDER BY "created_at" ASC, "id" ASC`;

    const rows = await this.pg<WorkflowRun[]>`
      SELECT *
      FROM "openworkflow"."workflow_runs"
      WHERE ${whereClause}
      ${order}
      LIMIT ${limit + 1}
    `;

    return this.processPaginationResults(rows, limit, !!after, !!before);
  }

  private buildListWorkflowRunsWhere(
    params: ListWorkflowRunsParams,
    cursor: Cursor | null,
  ) {
    const { after } = params;
    const conditions = [this.pg`"namespace_id" = ${this.namespaceId}`];

    if (cursor) {
      const op = after ? this.pg`>` : this.pg`<`;
      conditions.push(
        this.pg`("created_at", "id") ${op} (${cursor.createdAt}, ${cursor.id})`,
      );
    }

    let whereClause = conditions[0];
    if (!whereClause) throw new Error("No conditions");

    for (let i = 1; i < conditions.length; i++) {
      const condition = conditions[i];
      if (condition) {
        whereClause = this.pg`${whereClause} AND ${condition}`;
      }
    }
    return whereClause;
  }

  async claimWorkflowRun(
    params: ClaimWorkflowRunParams,
  ): Promise<WorkflowRun | null> {
    // 1. mark any deadline-expired workflow runs as failed
    // 2. find an available workflow run to claim
    // 3. claim the workflow run
    const [claimed] = await this.pg<WorkflowRun[]>`
      WITH expired AS (
        UPDATE "openworkflow"."workflow_runs"
        SET
          "status" = 'failed',
          "error" = ${this.pg.json({ message: "Workflow run deadline exceeded" })},
          "worker_id" = NULL,
          "available_at" = NULL,
          "finished_at" = NOW(),
          "updated_at" = NOW()
        WHERE "namespace_id" = ${this.namespaceId}
          AND "status" IN ('pending', 'running', 'sleeping')
          AND "deadline_at" IS NOT NULL
          AND "deadline_at" <= NOW()
        RETURNING "id"
      ),
      candidate AS (
        SELECT "id"
        FROM "openworkflow"."workflow_runs"
        WHERE "namespace_id" = ${this.namespaceId}
          AND "status" IN ('pending', 'running', 'sleeping')
          AND "available_at" <= NOW()
          AND ("deadline_at" IS NULL OR "deadline_at" > NOW())
        ORDER BY
          CASE WHEN "status" = 'pending' THEN 0 ELSE 1 END,
          "available_at",
          "created_at"
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "openworkflow"."workflow_runs" AS wr
      SET
        "status" = 'running',
        "attempts" = "attempts" + 1,
        "worker_id" = ${params.workerId},
        "available_at" = NOW() + ${params.leaseDurationMs} * INTERVAL '1 millisecond',
        "started_at" = COALESCE("started_at", NOW()),
        "updated_at" = NOW()
      FROM candidate
      WHERE wr."id" = candidate."id"
        AND wr."namespace_id" = ${this.namespaceId}
      RETURNING wr.*;
    `;

    return claimed ?? null;
  }

  async extendWorkflowRunLease(
    params: ExtendWorkflowRunLeaseParams,
  ): Promise<WorkflowRun> {
    const [updated] = await this.pg<WorkflowRun[]>`
      UPDATE "openworkflow"."workflow_runs"
      SET
        "available_at" = ${this.pg`NOW() + ${params.leaseDurationMs} * INTERVAL '1 millisecond'`},
        "updated_at" = NOW()
      WHERE "namespace_id" = ${this.namespaceId}
      AND "id" = ${params.workflowRunId}
      AND "status" = 'running'
      AND "worker_id" = ${params.workerId}
      RETURNING *
    `;

    if (!updated) throw new Error("Failed to extend lease for workflow run");

    return updated;
  }

  async sleepWorkflowRun(params: SleepWorkflowRunParams): Promise<WorkflowRun> {
    const [updated] = await this.pg<WorkflowRun[]>`
      UPDATE "openworkflow"."workflow_runs"
      SET
        "status" = 'sleeping',
        "available_at" = ${params.availableAt},
        "worker_id" = NULL,
        "updated_at" = NOW()
      WHERE "namespace_id" = ${this.namespaceId}
      AND "id" = ${params.workflowRunId}
      AND "status" != 'succeeded'
      AND "status" != 'failed'
      AND "status" != 'canceled'
      AND "worker_id" = ${params.workerId}
      RETURNING *
    `;

    if (!updated) throw new Error("Failed to sleep workflow run");

    return updated;
  }

  async completeWorkflowRun(
    params: CompleteWorkflowRunParams,
  ): Promise<WorkflowRun> {
    const [updated] = await this.pg<WorkflowRun[]>`
      UPDATE "openworkflow"."workflow_runs"
      SET
        "status" = 'succeeded',
        "output" = ${this.pg.json(params.output)},
        "error" = NULL,
        "worker_id" = ${params.workerId},
        "available_at" = NULL,
        "finished_at" = NOW(),
        "updated_at" = NOW()
      WHERE "namespace_id" = ${this.namespaceId}
      AND "id" = ${params.workflowRunId}
      AND "status" = 'running'
      AND "worker_id" = ${params.workerId}
      RETURNING *
    `;

    if (!updated) throw new Error("Failed to mark workflow run succeeded");

    return updated;
  }

  async failWorkflowRun(params: FailWorkflowRunParams): Promise<WorkflowRun> {
    const { workflowRunId, error } = params;
    const { initialIntervalMs, backoffCoefficient, maximumIntervalMs } =
      DEFAULT_RETRY_POLICY;

    // this beefy query updates a workflow's status, available_at, and
    // finished_at based on the workflow's deadline and retry policy
    //
    // if the next retry would exceed the deadline, the run is marked as
    // 'failed' and finalized, otherwise, the run is rescheduled with an updated
    // 'available_at' timestamp for the next retry
    const [updated] = await this.pg<WorkflowRun[]>`
      UPDATE "openworkflow"."workflow_runs"
      SET
        "status" = CASE
          WHEN "deadline_at" IS NOT NULL AND NOW() + (
            LEAST(
              ${initialIntervalMs} * POWER(${backoffCoefficient}, "attempts" - 1),
              ${maximumIntervalMs}
            ) * INTERVAL '1 millisecond'
          ) >= "deadline_at" THEN 'failed'
          ELSE 'pending'
        END,

        "available_at" = CASE
          WHEN "deadline_at" IS NOT NULL AND NOW() + (
            LEAST(
              ${initialIntervalMs} * POWER(${backoffCoefficient}, "attempts" - 1),
              ${maximumIntervalMs}
            ) * INTERVAL '1 millisecond'
          ) >= "deadline_at" THEN NULL
          ELSE NOW() + (
            LEAST(
              ${initialIntervalMs} * POWER(${backoffCoefficient}, "attempts" - 1),
              ${maximumIntervalMs}
            ) * INTERVAL '1 millisecond'
          )
        END,

        "finished_at" = CASE
          WHEN "deadline_at" IS NOT NULL AND NOW() + (
            LEAST(
              ${initialIntervalMs} * POWER(${backoffCoefficient}, "attempts" - 1),
              ${maximumIntervalMs}
            ) * INTERVAL '1 millisecond'
          ) >= "deadline_at" THEN NOW()
          ELSE NULL
        END,
        "error" = ${this.pg.json(error)},
        "worker_id" = NULL,
        "started_at" = NULL,
        "updated_at" = NOW()
      WHERE "namespace_id" = ${this.namespaceId}
      AND "id" = ${workflowRunId}
      AND "status" = 'running'
      AND "worker_id" = ${params.workerId}
      RETURNING *
    `;

    if (!updated) throw new Error("Failed to mark workflow run failed");

    return updated;
  }

  async cancelWorkflowRun(
    params: CancelWorkflowRunParams,
  ): Promise<WorkflowRun> {
    const [updated] = await this.pg<WorkflowRun[]>`
      UPDATE "openworkflow"."workflow_runs"
      SET
        "status" = 'canceled',
        "worker_id" = NULL,
        "available_at" = NULL,
        "finished_at" = NOW(),
        "updated_at" = NOW()
      WHERE "namespace_id" = ${this.namespaceId}
      AND "id" = ${params.workflowRunId}
      AND "status" IN ('pending', 'running', 'sleeping')
      RETURNING *
    `;

    if (!updated) {
      // workflow may already be in a terminal state
      const existing = await this.getWorkflowRun({
        workflowRunId: params.workflowRunId,
      });
      if (!existing) {
        throw new Error(`Workflow run ${params.workflowRunId} does not exist`);
      }

      // if already canceled, just return it
      if (existing.status === "canceled") {
        return existing;
      }

      // throw error for succeeded/failed workflows
      if (["succeeded", "failed"].includes(existing.status)) {
        throw new Error(
          `Cannot cancel workflow run ${params.workflowRunId} with status ${existing.status}`,
        );
      }

      throw new Error("Failed to cancel workflow run");
    }

    return updated;
  }

  async createStepAttempt(
    params: CreateStepAttemptParams,
  ): Promise<StepAttempt> {
    const [stepAttempt] = await this.pg<StepAttempt[]>`
      INSERT INTO "openworkflow"."step_attempts" (
        "namespace_id",
        "id",
        "workflow_run_id",
        "step_name",
        "kind",
        "status",
        "config",
        "context",
        "started_at",
        "created_at",
        "updated_at"
      )
      VALUES (
        ${this.namespaceId},
        gen_random_uuid(),
        ${params.workflowRunId},
        ${params.stepName},
        ${params.kind},
        'running',
        ${this.pg.json(params.config)},
        ${this.pg.json(params.context as JsonValue)},
        NOW(),
        date_trunc('milliseconds', NOW()),
        NOW()
      )
      RETURNING *
    `;

    if (!stepAttempt) throw new Error("Failed to create step attempt");

    return stepAttempt;
  }

  async getStepAttempt(
    params: GetStepAttemptParams,
  ): Promise<StepAttempt | null> {
    const [stepAttempt] = await this.pg<StepAttempt[]>`
      SELECT *
      FROM "openworkflow"."step_attempts"
      WHERE "namespace_id" = ${this.namespaceId}
      AND "id" = ${params.stepAttemptId}
      LIMIT 1
    `;
    return stepAttempt ?? null;
  }

  async listStepAttempts(
    params: ListStepAttemptsParams,
  ): Promise<PaginatedResponse<StepAttempt>> {
    const limit = params.limit ?? DEFAULT_PAGINATION_PAGE_SIZE;
    const { after, before } = params;

    let cursor: Cursor | null = null;
    if (after) {
      cursor = decodeCursor(after);
    } else if (before) {
      cursor = decodeCursor(before);
    }

    const whereClause = this.buildListStepAttemptsWhere(params, cursor);
    const order = before
      ? this.pg`ORDER BY "created_at" DESC, "id" DESC`
      : this.pg`ORDER BY "created_at" ASC, "id" ASC`;

    const rows = await this.pg<StepAttempt[]>`
      SELECT *
      FROM "openworkflow"."step_attempts"
      WHERE ${whereClause}
      ${order}
      LIMIT ${limit + 1}
    `;

    return this.processPaginationResults(rows, limit, !!after, !!before);
  }

  private buildListStepAttemptsWhere(
    params: ListStepAttemptsParams,
    cursor: Cursor | null,
  ) {
    const { after } = params;
    const conditions = [
      this.pg`"namespace_id" = ${this.namespaceId}`,
      this.pg`"workflow_run_id" = ${params.workflowRunId}`,
    ];

    if (cursor) {
      const op = after ? this.pg`>` : this.pg`<`;
      conditions.push(
        this.pg`("created_at", "id") ${op} (${cursor.createdAt}, ${cursor.id})`,
      );
    }

    let whereClause = conditions[0];
    if (!whereClause) throw new Error("No conditions");

    for (let i = 1; i < conditions.length; i++) {
      const condition = conditions[i];
      if (condition) {
        whereClause = this.pg`${whereClause} AND ${condition}`;
      }
    }
    return whereClause;
  }

  private processPaginationResults<T extends Cursor>(
    rows: T[],
    limit: number,
    hasAfter: boolean,
    hasBefore: boolean,
  ): PaginatedResponse<T> {
    const data = rows;
    let hasNext = false;
    let hasPrev = false;

    if (hasBefore) {
      data.reverse();
      if (data.length > limit) {
        hasPrev = true;
        data.shift();
      }
      hasNext = true;
    } else {
      if (data.length > limit) {
        hasNext = true;
        data.pop();
      }
      if (hasAfter) {
        hasPrev = true;
      }
    }

    const lastItem = data.at(-1);
    const nextCursor = hasNext && lastItem ? encodeCursor(lastItem) : null;
    const firstItem = data[0];
    const prevCursor = hasPrev && firstItem ? encodeCursor(firstItem) : null;

    return {
      data,
      pagination: {
        next: nextCursor,
        prev: prevCursor,
      },
    };
  }

  async completeStepAttempt(
    params: CompleteStepAttemptParams,
  ): Promise<StepAttempt> {
    const [updated] = await this.pg<StepAttempt[]>`
      UPDATE "openworkflow"."step_attempts" sa
      SET
        "status" = 'succeeded',
        "output" = ${this.pg.json(params.output)},
        "error" = NULL,
        "finished_at" = NOW(),
        "updated_at" = NOW()
      FROM "openworkflow"."workflow_runs" wr
      WHERE sa."namespace_id" = ${this.namespaceId}
      AND sa."workflow_run_id" = ${params.workflowRunId}
      AND sa."id" = ${params.stepAttemptId}
      AND sa."status" = 'running'
      AND wr."namespace_id" = sa."namespace_id"
      AND wr."id" = sa."workflow_run_id"
      AND wr."status" = 'running'
      AND wr."worker_id" = ${params.workerId}
      RETURNING sa.*
    `;

    if (!updated) throw new Error("Failed to mark step attempt succeeded");

    return updated;
  }

  async failStepAttempt(params: FailStepAttemptParams): Promise<StepAttempt> {
    const [updated] = await this.pg<StepAttempt[]>`
      UPDATE "openworkflow"."step_attempts" sa
      SET
        "status" = 'failed',
        "output" = NULL,
        "error" = ${this.pg.json(params.error)},
        "finished_at" = NOW(),
        "updated_at" = NOW()
      FROM "openworkflow"."workflow_runs" wr
      WHERE sa."namespace_id" = ${this.namespaceId}
      AND sa."workflow_run_id" = ${params.workflowRunId}
      AND sa."id" = ${params.stepAttemptId}
      AND sa."status" = 'running'
      AND wr."namespace_id" = sa."namespace_id"
      AND wr."id" = sa."workflow_run_id"
      AND wr."status" = 'running'
      AND wr."worker_id" = ${params.workerId}
      RETURNING sa.*
    `;

    if (!updated) throw new Error("Failed to mark step attempt failed");

    return updated;
  }
}

/**
 * sqlDateDefaultNow returns the provided date or `NOW()` if not.
 * This is needed so we don't have to disable the eslint rule for every query.
 */
function sqlDateDefaultNow(pg: Postgres, date: Date | null) {
  return date ?? pg`NOW()`;
}

/**
 * Cursor used for pagination. Requires created_at and id fields. Because JS
 * Date does not natively support microsecond precision dates, created_at should
 * be stored with millisecond precision in paginated tables to avoid issues with
 * cursor comparisons.
 */
interface Cursor {
  createdAt: Date;
  id: string;
}

function encodeCursor(item: Cursor): string {
  return Buffer.from(
    JSON.stringify({ createdAt: item.createdAt, id: item.id }),
  ).toString("base64");
}

function decodeCursor(cursor: string): Cursor {
  const decoded = Buffer.from(cursor, "base64").toString("utf8");
  const parsed = JSON.parse(decoded) as { createdAt: string; id: string };
  return {
    createdAt: new Date(parsed.createdAt),
    id: parsed.id,
  };
}
