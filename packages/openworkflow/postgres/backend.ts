import {
  DEFAULT_NAMESPACE_ID,
  DEFAULT_RUN_IDEMPOTENCY_PERIOD_MS,
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
  RescheduleWorkflowRunAfterFailedStepAttemptParams,
  CompleteWorkflowRunParams,
  SleepWorkflowRunParams,
} from "../backend.js";
import { wrapError } from "../core/error.js";
import { JsonValue } from "../core/json.js";
import { StepAttempt } from "../core/step.js";
import { WorkflowRun } from "../core/workflow.js";
import { computeFailedWorkflowRunUpdate } from "../workflow.js";
import {
  newPostgres,
  newPostgresMaxOne,
  Postgres,
  migrate,
  DEFAULT_SCHEMA,
  assertValidSchemaName,
} from "./postgres.js";

const DEFAULT_PAGINATION_PAGE_SIZE = 100;

interface BackendPostgresOptions {
  namespaceId?: string;
  runMigrations?: boolean;
  schema?: string;
}

/**
 * Manages a connection to a Postgres database for workflow operations.
 */
export class BackendPostgres implements Backend {
  private pg: Postgres;
  private namespaceId: string;
  private schema: string;

  private constructor(pg: Postgres, namespaceId: string, schema: string) {
    this.pg = pg;
    this.namespaceId = namespaceId;
    this.schema = schema;
  }

  /**
   * Create and initialize a new BackendPostgres instance. This will
   * automatically run migrations on startup unless `runMigrations` is set to
   * false.
   * @param url - Postgres connection URL
   * @param options - Backend options
   * @returns A connected backend instance
   * @throws {Error} Error connecting to the Postgres database
   */
  static async connect(
    url: string,
    options?: BackendPostgresOptions,
  ): Promise<BackendPostgres> {
    const { namespaceId, runMigrations, schema } = {
      namespaceId: DEFAULT_NAMESPACE_ID,
      runMigrations: true,
      schema: DEFAULT_SCHEMA,
      ...options,
    };
    assertValidSchemaName(schema);

    try {
      if (runMigrations) {
        const pgForMigrate = newPostgresMaxOne(url);
        await migrate(pgForMigrate, schema);
        await pgForMigrate.end();
      }

      const pg = newPostgres(url);
      return new BackendPostgres(pg, namespaceId, schema);
    } catch (error) {
      throw wrapError(
        'Postgres backend failed to connect. Check the connection URL (e.g. "postgresql://user:pass@host:port/db").',
        error,
      );
    }
  }

  async stop(): Promise<void> {
    await this.pg.end();
  }

  async createWorkflowRun(
    params: CreateWorkflowRunParams,
  ): Promise<WorkflowRun> {
    if (params.idempotencyKey === null) {
      return await this.insertWorkflowRun(this.pg, params);
    }

    const { workflowName, idempotencyKey } = params;
    const lockScope = JSON.stringify({
      namespaceId: this.namespaceId,
      workflowName,
      idempotencyKey,
    });

    return await this.pg.begin(async (_tx) => {
      const pgTx = _tx as unknown as Postgres;

      /* eslint-disable @cspell/spellchecker */
      await pgTx.unsafe(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0::bigint))",
        [lockScope],
      );
      /* eslint-enable @cspell/spellchecker */

      const existing = await this.getWorkflowRunByIdempotencyKey(
        pgTx,
        workflowName,
        idempotencyKey,
        new Date(Date.now() - DEFAULT_RUN_IDEMPOTENCY_PERIOD_MS),
      );
      if (existing) {
        return existing;
      }

      return await this.insertWorkflowRun(pgTx, params);
    });
  }

  private async insertWorkflowRun(
    pg: Postgres,
    params: CreateWorkflowRunParams,
  ): Promise<WorkflowRun> {
    const workflowRunsTable = this.workflowRunsTable(pg);

    const [workflowRun] = await pg<WorkflowRun[]>`
      INSERT INTO ${workflowRunsTable} (
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
        ${pg.json(params.config)},
        ${pg.json(params.context)},
        ${pg.json(params.input)},
        0,
        ${sqlDateDefaultNow(pg, params.availableAt)},
        ${params.deadlineAt},
        date_trunc('milliseconds', NOW()),
        NOW()
      )
      RETURNING *
    `;

    if (!workflowRun) throw new Error("Failed to create workflow run");

    return workflowRun;
  }

  private async getWorkflowRunByIdempotencyKey(
    pg: Postgres,
    workflowName: string,
    idempotencyKey: string,
    createdAt: Date,
  ): Promise<WorkflowRun | null> {
    const workflowRunsTable = this.workflowRunsTable(pg);

    const [workflowRun] = await pg<WorkflowRun[]>`
      SELECT *
      FROM ${workflowRunsTable}
      WHERE "namespace_id" = ${this.namespaceId}
        AND "workflow_name" = ${workflowName}
        AND "idempotency_key" = ${idempotencyKey}
        AND "created_at" >= ${createdAt}
      ORDER BY "created_at" ASC, "id" ASC
      LIMIT 1
    `;

    return workflowRun ?? null;
  }

  async getWorkflowRun(
    params: GetWorkflowRunParams,
  ): Promise<WorkflowRun | null> {
    const workflowRunsTable = this.workflowRunsTable();

    const [workflowRun] = await this.pg<WorkflowRun[]>`
      SELECT *
      FROM ${workflowRunsTable}
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
      ? this.pg`ORDER BY "created_at" ASC, "id" ASC`
      : this.pg`ORDER BY "created_at" DESC, "id" DESC`;
    const workflowRunsTable = this.workflowRunsTable();

    const rows = await this.pg<WorkflowRun[]>`
      SELECT *
      FROM ${workflowRunsTable}
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
      const op = after ? this.pg`<` : this.pg`>`;
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
    const workflowRunsTable = this.workflowRunsTable();

    const [claimed] = await this.pg<WorkflowRun[]>`
      WITH expired AS (
        UPDATE ${workflowRunsTable}
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
        FROM ${workflowRunsTable}
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
      UPDATE ${workflowRunsTable} AS wr
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
    const workflowRunsTable = this.workflowRunsTable();

    const [updated] = await this.pg<WorkflowRun[]>`
      UPDATE ${workflowRunsTable}
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
    // 'succeeded' status is deprecated
    const workflowRunsTable = this.workflowRunsTable();

    const [updated] = await this.pg<WorkflowRun[]>`
      UPDATE ${workflowRunsTable}
      SET
        "status" = 'sleeping',
        "available_at" = ${params.availableAt},
        "worker_id" = NULL,
        "updated_at" = NOW()
      WHERE "namespace_id" = ${this.namespaceId}
      AND "id" = ${params.workflowRunId}
      AND "status" != 'succeeded'
      AND "status" != 'completed'
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
    const workflowRunsTable = this.workflowRunsTable();

    const [updated] = await this.pg<WorkflowRun[]>`
      UPDATE ${workflowRunsTable}
      SET
        "status" = 'completed',
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

    if (!updated) throw new Error("Failed to mark workflow run completed");

    return updated;
  }

  async failWorkflowRun(params: FailWorkflowRunParams): Promise<WorkflowRun> {
    const { workflowRunId, error } = params;
    const currentTime = new Date();

    const workflowRun = await this.getWorkflowRun({ workflowRunId });
    if (!workflowRun) throw new Error("Workflow run not found");

    const failureUpdate = computeFailedWorkflowRunUpdate(
      params.retryPolicy,
      workflowRun.attempts,
      workflowRun.deadlineAt,
      error,
      currentTime,
    );

    const workflowRunsTable = this.workflowRunsTable();

    const [updated] = await this.pg<WorkflowRun[]>`
      UPDATE ${workflowRunsTable}
      SET
        "status" = ${failureUpdate.status},
        "available_at" = ${failureUpdate.availableAt},
        "finished_at" = ${failureUpdate.finishedAt},
        "error" = ${this.pg.json(failureUpdate.error)},
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

  async rescheduleWorkflowRunAfterFailedStepAttempt(
    params: RescheduleWorkflowRunAfterFailedStepAttemptParams,
  ): Promise<WorkflowRun> {
    const [updated] = await this.pg<WorkflowRun[]>`
      UPDATE "openworkflow"."workflow_runs"
      SET
        "status" = 'pending',
        "available_at" = ${params.availableAt},
        "finished_at" = NULL,
        "error" = ${this.pg.json(params.error)},
        "worker_id" = NULL,
        "started_at" = NULL,
        "updated_at" = NOW()
      WHERE "namespace_id" = ${this.namespaceId}
      AND "id" = ${params.workflowRunId}
      AND "status" = 'running'
      AND "worker_id" = ${params.workerId}
      RETURNING *
    `;

    if (!updated) {
      throw new Error(
        "Failed to reschedule workflow run after failed step attempt",
      );
    }

    return updated;
  }

  async cancelWorkflowRun(
    params: CancelWorkflowRunParams,
  ): Promise<WorkflowRun> {
    const workflowRunsTable = this.workflowRunsTable();

    const [updated] = await this.pg<WorkflowRun[]>`
      UPDATE ${workflowRunsTable}
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

      // throw error for completed/failed workflows
      // 'succeeded' status is deprecated
      if (["succeeded", "completed", "failed"].includes(existing.status)) {
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
    const stepAttemptsTable = this.stepAttemptsTable();

    const [stepAttempt] = await this.pg<StepAttempt[]>`
      INSERT INTO ${stepAttemptsTable} (
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
    const stepAttemptsTable = this.stepAttemptsTable();

    const [stepAttempt] = await this.pg<StepAttempt[]>`
      SELECT *
      FROM ${stepAttemptsTable}
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
    const stepAttemptsTable = this.stepAttemptsTable();

    const rows = await this.pg<StepAttempt[]>`
      SELECT *
      FROM ${stepAttemptsTable}
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
    const stepAttemptsTable = this.stepAttemptsTable();
    const workflowRunsTable = this.workflowRunsTable();

    const [updated] = await this.pg<StepAttempt[]>`
      UPDATE ${stepAttemptsTable} sa
      SET
        "status" = 'completed',
        "output" = ${this.pg.json(params.output)},
        "error" = NULL,
        "finished_at" = NOW(),
        "updated_at" = NOW()
      FROM ${workflowRunsTable} wr
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

    if (!updated) throw new Error("Failed to mark step attempt completed");

    return updated;
  }

  async failStepAttempt(params: FailStepAttemptParams): Promise<StepAttempt> {
    const stepAttemptsTable = this.stepAttemptsTable();
    const workflowRunsTable = this.workflowRunsTable();

    const [updated] = await this.pg<StepAttempt[]>`
      UPDATE ${stepAttemptsTable} sa
      SET
        "status" = 'failed',
        "output" = NULL,
        "error" = ${this.pg.json(params.error)},
        "finished_at" = NOW(),
        "updated_at" = NOW()
      FROM ${workflowRunsTable} wr
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

  private workflowRunsTable(pg: Postgres = this.pg) {
    return pg`${pg(this.schema)}.${pg("workflow_runs")}`;
  }

  private stepAttemptsTable(pg: Postgres = this.pg) {
    return pg`${pg(this.schema)}.${pg("step_attempts")}`;
  }
}

/**
 * sqlDateDefaultNow returns the provided date or `NOW()` if not.
 * This is needed so we don't have to disable the eslint rule for every query.
 * @param pg - Postgres client
 * @param date - Date to use (or null)
 * @returns The provided date or a NOW() expression
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

/**
 * Encode a pagination cursor to a string.
 * @param item - Cursor data
 * @returns Encoded cursor
 */
function encodeCursor(item: Cursor): string {
  return Buffer.from(
    JSON.stringify({ createdAt: item.createdAt, id: item.id }),
  ).toString("base64");
}

/**
 * Decode a pagination cursor from a string.
 * @param cursor - Encoded cursor
 * @returns Cursor data
 */
function decodeCursor(cursor: string): Cursor {
  const decoded = Buffer.from(cursor, "base64").toString("utf8");
  const parsed = JSON.parse(decoded) as { createdAt: string; id: string };
  return {
    createdAt: new Date(parsed.createdAt),
    id: parsed.id,
  };
}
