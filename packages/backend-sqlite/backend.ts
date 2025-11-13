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
  DEFAULT_DATABASE_PATH,
} from "./sqlite.js";
import {
  DEFAULT_NAMESPACE_ID,
  Backend,
  CancelWorkflowRunParams,
  ClaimWorkflowRunParams,
  CreateStepAttemptParams,
  CreateWorkflowRunParams,
  GetStepAttemptParams,
  GetWorkflowRunParams,
  HeartbeatWorkflowRunParams,
  ListStepAttemptsParams,
  MarkStepAttemptFailedParams,
  MarkStepAttemptSucceededParams,
  MarkWorkflowRunFailedParams,
  MarkWorkflowRunSucceededParams,
  SleepWorkflowRunParams,
  StepAttempt,
  WorkflowRun,
  DEFAULT_RETRY_POLICY,
  JsonValue,
} from "openworkflow";

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
   */
  static connect(
    path: string = DEFAULT_DATABASE_PATH,
    options?: BackendSqliteOptions,
  ): BackendSqlite {
    const { namespaceId, runMigrations } = {
      namespaceId: DEFAULT_NAMESPACE_ID,
      runMigrations: true,
      ...options,
    };

    const db = newDatabase(path);

    if (runMigrations) {
      migrate(db);
    }

    return new BackendSqlite(db, namespaceId);
  }

  stop(): void {
    this.db.close();
  }

  async createWorkflowRun(
    params: CreateWorkflowRunParams,
  ): Promise<WorkflowRun> {
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
        "config",
        "context",
        "input",
        "attempts",
        "available_at",
        "deadline_at",
        "created_at",
        "updated_at"
      )
      VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, 0, ?, ?, ?, ?)
    `);

    stmt.run(
      this.namespaceId,
      id,
      params.workflowName,
      params.version,
      params.idempotencyKey,
      toJSON(params.config),
      toJSON(params.context),
      toJSON(params.input),
      availableAt,
      toISO(params.deadlineAt),
      currentTime,
      currentTime,
    );

    const workflowRun = await this.getWorkflowRun({ workflowRunId: id });
    if (!workflowRun) throw new Error("Failed to create workflow run");

    return workflowRun;
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

    // SQLite doesn't have SKIP LOCKED, so we need to handle claims differently
    // We'll use a transaction to ensure atomicity

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
      SELECT "id"
      FROM "workflow_runs"
      WHERE "namespace_id" = ?
        AND "status" IN ('pending', 'running', 'sleeping')
        AND "available_at" <= ?
        AND ("deadline_at" IS NULL OR "deadline_at" > ?)
      ORDER BY
        CASE WHEN "status" = 'pending' THEN 0 ELSE 1 END,
        "available_at",
        "created_at"
      LIMIT 1
    `);

    const candidate = findStmt.get(
      this.namespaceId,
      currentTime,
      currentTime,
    ) as { id: string } | undefined;

    if (!candidate) return null;

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

    return await this.getWorkflowRun({ workflowRunId: candidate.id });
  }

  async heartbeatWorkflowRun(
    params: HeartbeatWorkflowRunParams,
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
      throw new Error("Failed to heartbeat workflow run");
    }

    const updated = await this.getWorkflowRun({
      workflowRunId: params.workflowRunId,
    });
    if (!updated) throw new Error("Failed to heartbeat workflow run");

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
      AND "status" NOT IN ('succeeded', 'failed', 'canceled')
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

  async markWorkflowRunSucceeded(
    params: MarkWorkflowRunSucceededParams,
  ): Promise<WorkflowRun> {
    const currentTime = now();

    const stmt = this.db.prepare(`
      UPDATE "workflow_runs"
      SET
        "status" = 'succeeded',
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
      throw new Error("Failed to mark workflow run succeeded");
    }

    const updated = await this.getWorkflowRun({
      workflowRunId: params.workflowRunId,
    });
    if (!updated) throw new Error("Failed to mark workflow run succeeded");

    return updated;
  }

  async markWorkflowRunFailed(
    params: MarkWorkflowRunFailedParams,
  ): Promise<WorkflowRun> {
    const { workflowRunId, error } = params;
    const { initialIntervalMs, backoffCoefficient, maximumIntervalMs } =
      DEFAULT_RETRY_POLICY;

    const currentTime = now();

    // Get the current workflow run to access attempts
    const workflowRun = await this.getWorkflowRun({ workflowRunId });
    if (!workflowRun) throw new Error("Workflow run not found");

    // Calculate retry delay
    const backoffMs =
      initialIntervalMs *
      Math.pow(backoffCoefficient, workflowRun.attempts - 1);
    const retryDelayMs = Math.min(backoffMs, maximumIntervalMs);

    // Determine if we should reschedule or permanently fail
    const nextRetryTime = new Date(Date.now() + retryDelayMs);
    const shouldRetry =
      !workflowRun.deadlineAt || nextRetryTime < workflowRun.deadlineAt;

    const status = shouldRetry ? "pending" : "failed";
    const availableAt = shouldRetry ? nextRetryTime.toISOString() : null;
    const finishedAt = shouldRetry ? null : currentTime;

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
      status,
      availableAt,
      finishedAt,
      toJSON(error),
      currentTime,
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

      // throw error for succeeded/failed workflows
      if (["succeeded", "failed"].includes(existing.status)) {
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

  listStepAttempts(params: ListStepAttemptsParams): Promise<StepAttempt[]> {
    const stmt = this.db.prepare(`
      SELECT *
      FROM "step_attempts"
      WHERE "namespace_id" = ? AND "workflow_run_id" = ?
      ORDER BY "created_at"
    `);

    const rows = stmt.all(this.namespaceId, params.workflowRunId);

    if (!Array.isArray(rows)) return Promise.resolve([]);

    return Promise.resolve(
      rows.map((row) => rowToStepAttempt(row as unknown as StepAttemptRow)),
    );
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

  async markStepAttemptSucceeded(
    params: MarkStepAttemptSucceededParams,
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
      throw new Error("Failed to mark step attempt succeeded");
    }

    const stmt = this.db.prepare(`
      UPDATE "step_attempts"
      SET
        "status" = 'succeeded',
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
      throw new Error("Failed to mark step attempt succeeded");
    }

    const updated = await this.getStepAttempt({
      stepAttemptId: params.stepAttemptId,
    });
    if (!updated) throw new Error("Failed to mark step attempt succeeded");

    return updated;
  }

  async markStepAttemptFailed(
    params: MarkStepAttemptFailedParams,
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
