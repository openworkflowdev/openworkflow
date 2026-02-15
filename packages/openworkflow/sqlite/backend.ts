import {
  CONCURRENCY_LIMIT_MISMATCH_ERROR,
  normalizeCreateWorkflowRunParams,
  toConcurrencyBucket,
} from "../backend-concurrency.js";
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
  newDatabase,
  Database,
  migrate,
  generateUUID,
  now,
  addMilliseconds,
  toJSON,
  fromJSON,
  toISO,
  fromISO,
} from "./sqlite.js";

const DEFAULT_PAGINATION_PAGE_SIZE = 100;

interface BackendSqliteOptions {
  namespaceId?: string;
  runMigrations?: boolean;
}

/**
 * Manages a connection to a SQLite database for workflow operations.
 */
export class BackendSqlite implements Backend {
  private db: Database;
  private namespaceId: string;

  private constructor(db: Database, namespaceId: string) {
    this.db = db;
    this.namespaceId = namespaceId;
  }

  /**
   * Create and initialize a new BackendSqlite instance. This will
   * automatically run migrations on startup unless `runMigrations` is set to
   * false.
   * @param path - Database path
   * @param options - Backend options
   * @returns A connected backend instance
   * @throws {Error} Error connecting to the SQLite database
   */
  static connect(path: string, options?: BackendSqliteOptions): BackendSqlite {
    const { namespaceId, runMigrations } = {
      namespaceId: DEFAULT_NAMESPACE_ID,
      runMigrations: true,
      ...options,
    };

    try {
      const db = newDatabase(path);

      if (runMigrations) {
        migrate(db);
      }

      return new BackendSqlite(db, namespaceId);
    } catch (error) {
      throw wrapError(
        "SQLite backend failed to open database. Check the path is valid and writable.",
        error,
      );
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async stop(): Promise<void> {
    this.db.close();
  }

  createWorkflowRun(params: CreateWorkflowRunParams): Promise<WorkflowRun> {
    const normalizedParams = normalizeCreateWorkflowRunParams(params);
    const concurrencyBucket = toConcurrencyBucket(normalizedParams);
    const { workflowName, idempotencyKey } = normalizedParams;

    if (idempotencyKey === null && concurrencyBucket === null) {
      return Promise.resolve(this.insertWorkflowRun(normalizedParams));
    }

    try {
      // BEGIN IMMEDIATE takes a RESERVED write lock up-front. This serializes
      // create checks/writes across writers, which is the SQLite consistency
      // model we rely on (instead of row/advisory locks).
      this.db.exec("BEGIN IMMEDIATE");

      if (idempotencyKey !== null) {
        const existing = this.getWorkflowRunByIdempotencyKey(
          workflowName,
          idempotencyKey,
          new Date(Date.now() - DEFAULT_RUN_IDEMPOTENCY_PERIOD_MS),
        );
        if (existing) {
          this.db.exec("COMMIT");
          return Promise.resolve(existing);
        }
      }

      if (concurrencyBucket) {
        this.assertNoActiveBucketConcurrencyLimitMismatch(concurrencyBucket);
      }

      const workflowRun = this.insertWorkflowRun(normalizedParams);
      this.db.exec("COMMIT");
      return Promise.resolve(workflowRun);
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // ignore
      }

      return Promise.reject(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  private insertWorkflowRun(params: CreateWorkflowRunParams): WorkflowRun {
    const id = generateUUID();
    const currentTime = now();
    const availableAt = params.availableAt
      ? toISO(params.availableAt)
      : currentTime;

    const stmt = this.db.prepare(`
      INSERT INTO "workflow_runs" (
        "namespace_id",
        "id",
        "workflow_name",
        "version",
        "status",
        "idempotency_key",
        "concurrency_key",
        "concurrency_limit",
        "config",
        "context",
        "input",
        "attempts",
        "available_at",
        "deadline_at",
        "created_at",
        "updated_at"
      )
      VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
    `);

    stmt.run(
      this.namespaceId,
      id,
      params.workflowName,
      params.version,
      params.idempotencyKey,
      params.concurrencyKey ?? null,
      params.concurrencyLimit ?? null,
      toJSON(params.config),
      toJSON(params.context),
      toJSON(params.input),
      availableAt,
      toISO(params.deadlineAt),
      currentTime,
      currentTime,
    );

    const row = this.db
      .prepare(
        `
      SELECT *
      FROM "workflow_runs"
      WHERE "namespace_id" = ? AND "id" = ?
      LIMIT 1
    `,
      )
      .get(this.namespaceId, id) as WorkflowRunRow | undefined;
    if (!row) throw new Error("Failed to create workflow run");

    return rowToWorkflowRun(row);
  }

  private getWorkflowRunByIdempotencyKey(
    workflowName: string,
    idempotencyKey: string,
    createdAt: Date,
  ): WorkflowRun | null {
    const stmt = this.db.prepare(`
      SELECT *
      FROM "workflow_runs"
      WHERE "namespace_id" = ?
        AND "workflow_name" = ?
        AND "idempotency_key" = ?
        AND "created_at" >= ?
      ORDER BY "created_at" ASC, "id" ASC
      LIMIT 1
    `);

    const row = stmt.get(
      this.namespaceId,
      workflowName,
      idempotencyKey,
      toISO(createdAt),
    ) as WorkflowRunRow | undefined;
    return row ? rowToWorkflowRun(row) : null;
  }

  private assertNoActiveBucketConcurrencyLimitMismatch(params: {
    workflowName: string;
    version: string | null;
    key: string | null;
    limit: number;
  }): void {
    const stmt = this.db.prepare(`
      SELECT "id"
      FROM "workflow_runs"
      WHERE "namespace_id" = ?
        AND "workflow_name" = ?
        AND (
          "version" = ?
          OR ("version" IS NULL AND ? IS NULL)
        )
        AND (
          "concurrency_key" = ?
          OR ("concurrency_key" IS NULL AND ? IS NULL)
        )
        -- Sleeping runs are excluded so long sleeps do not pin historical
        -- limits and block new run creation after config changes.
        AND "status" IN ('pending', 'running')
        -- "params.limit" is always non-null because this is called only when
        -- toConcurrencyBucket() returns a constrained bucket.
        AND ("concurrency_limit" <> ? OR "concurrency_limit" IS NULL)
      LIMIT 1
    `);

    const conflict = stmt.get(
      this.namespaceId,
      params.workflowName,
      params.version,
      params.version,
      params.key,
      params.key,
      params.limit,
    ) as { id: string } | undefined;

    if (conflict) {
      throw new Error(CONCURRENCY_LIMIT_MISMATCH_ERROR);
    }
  }

  getWorkflowRun(params: GetWorkflowRunParams): Promise<WorkflowRun | null> {
    const stmt = this.db.prepare(`
      SELECT *
      FROM "workflow_runs"
      WHERE "namespace_id" = ? AND "id" = ?
      LIMIT 1
    `);

    const row = stmt.get(this.namespaceId, params.workflowRunId) as
      | WorkflowRunRow
      | undefined;

    return Promise.resolve(row ? rowToWorkflowRun(row) : null);
  }

  async claimWorkflowRun(
    params: ClaimWorkflowRunParams,
  ): Promise<WorkflowRun | null> {
    const currentTime = now();
    const newAvailableAt = addMilliseconds(currentTime, params.leaseDurationMs);

    // SQLite doesn't have SKIP LOCKED. BEGIN IMMEDIATE serializes writers with
    // the database's single-writer lock, which is the intended claim model.
    this.db.exec("BEGIN IMMEDIATE");

    try {
      // 1. mark any deadline-expired workflow runs as failed
      const expireStmt = this.db.prepare(`
        UPDATE "workflow_runs"
        SET
          "status" = 'failed',
          "error" = ?,
          "worker_id" = NULL,
          "available_at" = NULL,
          "finished_at" = ?,
          "updated_at" = ?
        WHERE "namespace_id" = ?
          AND "status" IN ('pending', 'running', 'sleeping')
          AND "deadline_at" IS NOT NULL
          AND "deadline_at" <= ?
      `);

      expireStmt.run(
        toJSON({ message: "Workflow run deadline exceeded" }),
        currentTime,
        currentTime,
        this.namespaceId,
        currentTime,
      );

      // 2. find an available workflow run to claim
      const findStmt = this.db.prepare(`
        SELECT wr."id"
        FROM "workflow_runs" AS wr
        WHERE wr."namespace_id" = ?
          AND wr."status" IN ('pending', 'running', 'sleeping')
          AND wr."available_at" <= ?
          AND (wr."deadline_at" IS NULL OR wr."deadline_at" > ?)
          AND (
            wr."concurrency_limit" IS NULL
            OR (
              -- TODO: If claim latency becomes a hot spot, replace this
              -- correlated count with precomputed bucket counts via a CTE.
              SELECT COUNT(*)
              FROM "workflow_runs" AS active
              WHERE active."namespace_id" = wr."namespace_id"
                AND active."workflow_name" = wr."workflow_name"
                AND (
                  active."version" = wr."version"
                  OR (
                    active."version" IS NULL
                    AND wr."version" IS NULL
                  )
                )
                AND (
                  active."concurrency_key" = wr."concurrency_key"
                  OR (
                    active."concurrency_key" IS NULL
                    AND wr."concurrency_key" IS NULL
                  )
                )
                AND active."status" = 'running'
                -- Candidates require available_at <= now; active leased runs
                -- require available_at > now. Keep explicit self-exclusion
                -- for readability/safety.
                AND active."id" <> wr."id"
                AND active."available_at" > ?
            ) < wr."concurrency_limit"
          )
        ORDER BY
          CASE WHEN wr."status" = 'pending' THEN 0 ELSE 1 END,
          wr."available_at",
          wr."created_at"
        LIMIT 1
      `);

      const candidate = findStmt.get(
        this.namespaceId,
        currentTime,
        currentTime,
        currentTime,
      ) as { id: string } | undefined;

      if (!candidate) {
        this.db.exec("COMMIT");
        return null;
      }

      // 3. claim the workflow run
      const claimStmt = this.db.prepare(`
        UPDATE "workflow_runs"
        SET
          "status" = 'running',
          "attempts" = "attempts" + 1,
          "worker_id" = ?,
          "available_at" = ?,
          "started_at" = COALESCE("started_at", ?),
          "updated_at" = ?
        WHERE "id" = ?
          AND "namespace_id" = ?
      `);

      claimStmt.run(
        params.workerId,
        newAvailableAt,
        currentTime,
        currentTime,
        candidate.id,
        this.namespaceId,
      );

      this.db.exec("COMMIT");

      return await this.getWorkflowRun({ workflowRunId: candidate.id });
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  async extendWorkflowRunLease(
    params: ExtendWorkflowRunLeaseParams,
  ): Promise<WorkflowRun> {
    const currentTime = now();
    const newAvailableAt = addMilliseconds(currentTime, params.leaseDurationMs);

    const stmt = this.db.prepare(`
      UPDATE "workflow_runs"
      SET
        "available_at" = ?,
        "updated_at" = ?
      WHERE "namespace_id" = ?
      AND "id" = ?
      AND "status" = 'running'
      AND "worker_id" = ?
    `);

    const result = stmt.run(
      newAvailableAt,
      currentTime,
      this.namespaceId,
      params.workflowRunId,
      params.workerId,
    );

    if (result.changes === 0) {
      throw new Error("Failed to extend lease for workflow run");
    }

    const updated = await this.getWorkflowRun({
      workflowRunId: params.workflowRunId,
    });
    if (!updated) throw new Error("Failed to extend lease for workflow run");

    return updated;
  }

  async sleepWorkflowRun(params: SleepWorkflowRunParams): Promise<WorkflowRun> {
    const currentTime = now();

    const stmt = this.db.prepare(`
      UPDATE "workflow_runs"
      SET
        "status" = 'sleeping',
        "available_at" = ?,
        "worker_id" = NULL,
        "updated_at" = ?
      WHERE "namespace_id" = ?
      AND "id" = ?
      AND "status" NOT IN ('completed', 'failed', 'canceled')
      AND "worker_id" = ?
    `);

    const result = stmt.run(
      toISO(params.availableAt),
      currentTime,
      this.namespaceId,
      params.workflowRunId,
      params.workerId,
    );

    if (result.changes === 0) {
      throw new Error("Failed to sleep workflow run");
    }

    const updated = await this.getWorkflowRun({
      workflowRunId: params.workflowRunId,
    });
    if (!updated) throw new Error("Failed to sleep workflow run");

    return updated;
  }

  async completeWorkflowRun(
    params: CompleteWorkflowRunParams,
  ): Promise<WorkflowRun> {
    const currentTime = now();

    const stmt = this.db.prepare(`
      UPDATE "workflow_runs"
      SET
        "status" = 'completed',
        "output" = ?,
        "error" = NULL,
        "worker_id" = ?,
        "available_at" = NULL,
        "finished_at" = ?,
        "updated_at" = ?
      WHERE "namespace_id" = ?
      AND "id" = ?
      AND "status" = 'running'
      AND "worker_id" = ?
    `);

    const result = stmt.run(
      toJSON(params.output),
      params.workerId,
      currentTime,
      currentTime,
      this.namespaceId,
      params.workflowRunId,
      params.workerId,
    );

    if (result.changes === 0) {
      throw new Error("Failed to mark workflow run completed");
    }

    const updated = await this.getWorkflowRun({
      workflowRunId: params.workflowRunId,
    });
    if (!updated) throw new Error("Failed to mark workflow run completed");

    return updated;
  }

  async failWorkflowRun(params: FailWorkflowRunParams): Promise<WorkflowRun> {
    const { workflowRunId, error } = params;
    const currentTime = new Date();
    const currentTimeIso = currentTime.toISOString();

    const workflowRun = await this.getWorkflowRun({ workflowRunId });
    if (!workflowRun) throw new Error("Workflow run not found");

    const failureUpdate = computeFailedWorkflowRunUpdate(
      params.retryPolicy,
      workflowRun.attempts,
      workflowRun.deadlineAt,
      error,
      currentTime,
    );

    const stmt = this.db.prepare(`
      UPDATE "workflow_runs"
      SET
        "status" = ?,
        "available_at" = ?,
        "finished_at" = ?,
        "error" = ?,
        "worker_id" = NULL,
        "started_at" = NULL,
        "updated_at" = ?
      WHERE "namespace_id" = ?
      AND "id" = ?
      AND "status" = 'running'
      AND "worker_id" = ?
    `);

    const result = stmt.run(
      failureUpdate.status,
      failureUpdate.availableAt?.toISOString() ?? null,
      failureUpdate.finishedAt?.toISOString() ?? null,
      toJSON(failureUpdate.error),
      currentTimeIso,
      this.namespaceId,
      workflowRunId,
      params.workerId,
    );

    if (result.changes === 0) {
      throw new Error("Failed to mark workflow run failed");
    }

    const updated = await this.getWorkflowRun({ workflowRunId });
    if (!updated) throw new Error("Failed to mark workflow run failed");

    return updated;
  }

  rescheduleWorkflowRunAfterFailedStepAttempt(
    params: RescheduleWorkflowRunAfterFailedStepAttemptParams,
  ): Promise<WorkflowRun> {
    const currentTime = now();

    const stmt = this.db.prepare(`
      UPDATE "workflow_runs"
      SET
        "status" = 'pending',
        "available_at" = ?,
        "finished_at" = NULL,
        "error" = ?,
        "worker_id" = NULL,
        "started_at" = NULL,
        "updated_at" = ?
      WHERE "namespace_id" = ?
      AND "id" = ?
      AND "status" = 'running'
      AND "worker_id" = ?
      RETURNING *
    `);

    const row = stmt.get(
      toISO(params.availableAt),
      toJSON(params.error),
      currentTime,
      this.namespaceId,
      params.workflowRunId,
      params.workerId,
    ) as WorkflowRunRow | undefined;
    if (!row) {
      return Promise.reject(
        new Error(
          "Failed to reschedule workflow run after failed step attempt",
        ),
      );
    }

    return Promise.resolve(rowToWorkflowRun(row));
  }

  async cancelWorkflowRun(
    params: CancelWorkflowRunParams,
  ): Promise<WorkflowRun> {
    const currentTime = now();

    const stmt = this.db.prepare(`
      UPDATE "workflow_runs"
      SET
        "status" = 'canceled',
        "worker_id" = NULL,
        "available_at" = NULL,
        "finished_at" = ?,
        "updated_at" = ?
      WHERE "namespace_id" = ?
      AND "id" = ?
      AND "status" IN ('pending', 'running', 'sleeping')
    `);

    const result = stmt.run(
      currentTime,
      currentTime,
      this.namespaceId,
      params.workflowRunId,
    );

    if (result.changes === 0) {
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
      if (["completed", "failed"].includes(existing.status)) {
        throw new Error(
          `Cannot cancel workflow run ${params.workflowRunId} with status ${existing.status}`,
        );
      }

      throw new Error("Failed to cancel workflow run");
    }

    const updated = await this.getWorkflowRun({
      workflowRunId: params.workflowRunId,
    });
    if (!updated) throw new Error("Failed to cancel workflow run");

    return updated;
  }

  listWorkflowRuns(
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

    const order = before
      ? `ORDER BY "created_at" ASC, "id" ASC`
      : `ORDER BY "created_at" DESC, "id" DESC`;

    let query: string;
    let queryParams: (string | number)[];

    if (cursor) {
      const op = after ? "<" : ">";
      query = `
        SELECT *
        FROM "workflow_runs"
        WHERE "namespace_id" = ?
          AND ("created_at", "id") ${op} (?, ?)
        ${order}
        LIMIT ?
      `;
      queryParams = [
        this.namespaceId,
        cursor.createdAt.toISOString(),
        cursor.id,
        limit + 1,
      ];
    } else {
      query = `
        SELECT *
        FROM "workflow_runs"
        WHERE "namespace_id" = ?
        ${order}
        LIMIT ?
      `;
      queryParams = [this.namespaceId, limit + 1];
    }

    const stmt = this.db.prepare(query);
    const rawRows = stmt.all(...queryParams);

    if (!Array.isArray(rawRows)) {
      return Promise.resolve({
        data: [],
        pagination: { next: null, prev: null },
      });
    }

    const rows = rawRows.map((row) => rowToWorkflowRun(row as WorkflowRunRow));

    return Promise.resolve(
      this.processPaginationResults(rows, limit, !!after, !!before),
    );
  }

  listStepAttempts(
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

    const order = before
      ? `ORDER BY "created_at" DESC, "id" DESC`
      : `ORDER BY "created_at" ASC, "id" ASC`;

    let query: string;
    let queryParams: (string | number)[];

    if (cursor) {
      const op = after ? ">" : "<";
      query = `
        SELECT *
        FROM "step_attempts"
        WHERE "namespace_id" = ?
          AND "workflow_run_id" = ?
          AND ("created_at", "id") ${op} (?, ?)
        ${order}
        LIMIT ?
      `;
      queryParams = [
        this.namespaceId,
        params.workflowRunId,
        cursor.createdAt.toISOString(),
        cursor.id,
        limit + 1,
      ];
    } else {
      query = `
        SELECT *
        FROM "step_attempts"
        WHERE "namespace_id" = ?
          AND "workflow_run_id" = ?
        ${order}
        LIMIT ?
      `;
      queryParams = [this.namespaceId, params.workflowRunId, limit + 1];
    }

    const stmt = this.db.prepare(query);
    const rawRows = stmt.all(...queryParams);

    if (!Array.isArray(rawRows)) {
      return Promise.resolve({
        data: [],
        pagination: { next: null, prev: null },
      });
    }

    const rows = rawRows.map((row) => rowToStepAttempt(row as StepAttemptRow));

    return Promise.resolve(
      this.processPaginationResults(rows, limit, !!after, !!before),
    );
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

  async createStepAttempt(
    params: CreateStepAttemptParams,
  ): Promise<StepAttempt> {
    const id = generateUUID();
    const currentTime = now();

    const stmt = this.db.prepare(`
      INSERT INTO "step_attempts" (
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
      VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?, ?, ?)
    `);

    stmt.run(
      this.namespaceId,
      id,
      params.workflowRunId,
      params.stepName,
      params.kind,
      toJSON(params.config),
      toJSON(params.context as JsonValue),
      currentTime,
      currentTime,
      currentTime,
    );

    const stepAttempt = await this.getStepAttempt({ stepAttemptId: id });
    if (!stepAttempt) throw new Error("Failed to create step attempt");

    return stepAttempt;
  }

  getStepAttempt(params: GetStepAttemptParams): Promise<StepAttempt | null> {
    const stmt = this.db.prepare(`
      SELECT *
      FROM "step_attempts"
      WHERE "namespace_id" = ? AND "id" = ?
      LIMIT 1
    `);

    const row = stmt.get(this.namespaceId, params.stepAttemptId) as
      | StepAttemptRow
      | undefined;

    return Promise.resolve(row ? rowToStepAttempt(row) : null);
  }

  async completeStepAttempt(
    params: CompleteStepAttemptParams,
  ): Promise<StepAttempt> {
    const currentTime = now();

    // Check that the workflow is running and owned by the worker
    const workflowStmt = this.db.prepare(`
      SELECT "id"
      FROM "workflow_runs"
      WHERE "namespace_id" = ?
      AND "id" = ?
      AND "status" = 'running'
      AND "worker_id" = ?
    `);

    const workflowRow = workflowStmt.get(
      this.namespaceId,
      params.workflowRunId,
      params.workerId,
    ) as { id: string } | undefined;

    if (!workflowRow) {
      throw new Error("Failed to mark step attempt completed");
    }

    const stmt = this.db.prepare(`
      UPDATE "step_attempts"
      SET
        "status" = 'completed',
        "output" = ?,
        "error" = NULL,
        "finished_at" = ?,
        "updated_at" = ?
      WHERE "namespace_id" = ?
      AND "workflow_run_id" = ?
      AND "id" = ?
      AND "status" = 'running'
    `);

    const result = stmt.run(
      toJSON(params.output),
      currentTime,
      currentTime,
      this.namespaceId,
      params.workflowRunId,
      params.stepAttemptId,
    );

    if (result.changes === 0) {
      throw new Error("Failed to mark step attempt completed");
    }

    const updated = await this.getStepAttempt({
      stepAttemptId: params.stepAttemptId,
    });
    if (!updated) throw new Error("Failed to mark step attempt completed");

    return updated;
  }

  async failStepAttempt(params: FailStepAttemptParams): Promise<StepAttempt> {
    const currentTime = now();

    // Check that the workflow is running and owned by the worker
    const workflowStmt = this.db.prepare(`
      SELECT "id"
      FROM "workflow_runs"
      WHERE "namespace_id" = ?
      AND "id" = ?
      AND "status" = 'running'
      AND "worker_id" = ?
    `);

    const workflowRow = workflowStmt.get(
      this.namespaceId,
      params.workflowRunId,
      params.workerId,
    ) as { id: string } | undefined;

    if (!workflowRow) {
      throw new Error("Failed to mark step attempt failed");
    }

    const stmt = this.db.prepare(`
      UPDATE "step_attempts"
      SET
        "status" = 'failed',
        "output" = NULL,
        "error" = ?,
        "finished_at" = ?,
        "updated_at" = ?
      WHERE "namespace_id" = ?
      AND "workflow_run_id" = ?
      AND "id" = ?
      AND "status" = 'running'
    `);

    const result = stmt.run(
      toJSON(params.error),
      currentTime,
      currentTime,
      this.namespaceId,
      params.workflowRunId,
      params.stepAttemptId,
    );

    if (result.changes === 0) {
      throw new Error("Failed to mark step attempt failed");
    }

    const updated = await this.getStepAttempt({
      stepAttemptId: params.stepAttemptId,
    });
    if (!updated) throw new Error("Failed to mark step attempt failed");

    return updated;
  }
}

// Row types for SQLite results
interface WorkflowRunRow {
  namespace_id: string;
  id: string;
  workflow_name: string;
  version: string | null;
  status: string;
  idempotency_key: string | null;
  concurrency_key: string | null;
  concurrency_limit: number | null;
  config: string;
  context: string | null;
  input: string | null;
  output: string | null;
  error: string | null;
  attempts: number;
  parent_step_attempt_namespace_id: string | null;
  parent_step_attempt_id: string | null;
  worker_id: string | null;
  available_at: string | null;
  deadline_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

interface StepAttemptRow {
  namespace_id: string;
  id: string;
  workflow_run_id: string;
  step_name: string;
  kind: string;
  status: string;
  config: string;
  context: string | null;
  output: string | null;
  error: string | null;
  child_workflow_run_namespace_id: string | null;
  child_workflow_run_id: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

// Conversion functions
/**
 * Convert a database row to a WorkflowRun.
 * @param row - Workflow run row
 * @returns Workflow run
 * @throws {Error} If required fields are missing
 */
function rowToWorkflowRun(row: WorkflowRunRow): WorkflowRun {
  const createdAt = fromISO(row.created_at);
  const updatedAt = fromISO(row.updated_at);
  const config = fromJSON(row.config);

  if (!createdAt) throw new Error("createdAt is required");
  if (!updatedAt) throw new Error("updatedAt is required");
  if (config === null) throw new Error("config is required");

  return {
    namespaceId: row.namespace_id,
    id: row.id,
    workflowName: row.workflow_name,
    version: row.version,
    status: row.status as WorkflowRun["status"],
    idempotencyKey: row.idempotency_key,
    concurrencyKey: row.concurrency_key,
    concurrencyLimit: row.concurrency_limit,
    config: config as WorkflowRun["config"],
    context: fromJSON(row.context) as WorkflowRun["context"],
    input: fromJSON(row.input) as WorkflowRun["input"],
    output: fromJSON(row.output) as WorkflowRun["output"],
    error: fromJSON(row.error) as WorkflowRun["error"],
    attempts: row.attempts,
    parentStepAttemptNamespaceId: row.parent_step_attempt_namespace_id,
    parentStepAttemptId: row.parent_step_attempt_id,
    workerId: row.worker_id,
    availableAt: fromISO(row.available_at),
    deadlineAt: fromISO(row.deadline_at),
    startedAt: fromISO(row.started_at),
    finishedAt: fromISO(row.finished_at),
    createdAt,
    updatedAt,
  };
}

/**
 * Convert a database row to a StepAttempt.
 * @param row - Step attempt row
 * @returns Step attempt
 * @throws {Error} If required fields are missing
 */
function rowToStepAttempt(row: StepAttemptRow): StepAttempt {
  const createdAt = fromISO(row.created_at);
  const updatedAt = fromISO(row.updated_at);
  const config = fromJSON(row.config);

  if (!createdAt) throw new Error("createdAt is required");
  if (!updatedAt) throw new Error("updatedAt is required");
  if (config === null) throw new Error("config is required");

  return {
    namespaceId: row.namespace_id,
    id: row.id,
    workflowRunId: row.workflow_run_id,
    stepName: row.step_name,
    kind: row.kind as StepAttempt["kind"],
    status: row.status as StepAttempt["status"],
    config: config as StepAttempt["config"],
    context: fromJSON(row.context) as StepAttempt["context"],
    output: fromJSON(row.output) as StepAttempt["output"],
    error: fromJSON(row.error) as StepAttempt["error"],
    childWorkflowRunNamespaceId: row.child_workflow_run_namespace_id,
    childWorkflowRunId: row.child_workflow_run_id,
    startedAt: fromISO(row.started_at),
    finishedAt: fromISO(row.finished_at),
    createdAt,
    updatedAt,
  };
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
