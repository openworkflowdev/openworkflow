import {
  Backend,
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
  StepAttempt,
  WorkflowRun,
} from "../backend/index.js";
import { newPostgres, Postgres } from "./postgres.js";

export class BackendPostgres implements Backend {
  private pg: Postgres;

  constructor(url: string) {
    this.pg = newPostgres(url);
  }

  async end(): Promise<void> {
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
        "context",
        "input",
        "attempts",
        "available_at",
        "created_at",
        "updated_at"
      )
      VALUES (
        ${params.namespaceId},
        gen_random_uuid(),
        ${params.workflowName},
        ${params.version},
        'pending',
        ${params.idempotencyKey},
        ${this.pg.json(params.context)},
        ${this.pg.json(params.input)},
        0,
        ${sqlDateDefaultNow(this.pg, params.availableAt)},
        NOW(),
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
      WHERE "namespace_id" = ${params.namespaceId}
      AND "id" = ${params.workflowRunId}
      LIMIT 1
    `;

    return workflowRun ?? null;
  }

  async claimWorkflowRun(
    params: ClaimWorkflowRunParams,
  ): Promise<WorkflowRun | null> {
    const [claimed] = await this.pg<WorkflowRun[]>`
      WITH candidate AS (
        SELECT "id"
        FROM "openworkflow"."workflow_runs"
        WHERE "namespace_id" = ${params.namespaceId}
          AND "status" IN ('pending', 'running')
          AND "available_at" <= NOW()
        ORDER BY
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
        AND wr."namespace_id" = ${params.namespaceId}
      RETURNING wr.*;
    `;

    return claimed ?? null;
  }

  async heartbeatWorkflowRun(
    params: HeartbeatWorkflowRunParams,
  ): Promise<void> {
    const [updated] = await this.pg`
      UPDATE "openworkflow"."workflow_runs"
      SET
        "available_at" = ${this.pg`NOW() + ${params.leaseDurationMs} * INTERVAL '1 millisecond'`},
        "updated_at" = NOW()
      WHERE "namespace_id" = ${params.namespaceId}
      AND "id" = ${params.workflowRunId}
      AND "status" = 'running'
      AND "worker_id" = ${params.workerId}
      RETURNING "id"
    `;
    if (!updated) throw new Error("Failed to heartbeat workflow run");
  }

  async markWorkflowRunSucceeded(
    params: MarkWorkflowRunSucceededParams,
  ): Promise<void> {
    const [updated] = await this.pg`
      UPDATE "openworkflow"."workflow_runs"
      SET
        "status" = 'succeeded',
        "output" = ${this.pg.json(params.output)},
        "error" = NULL,
        "worker_id" = ${params.workerId},
        "available_at" = NULL,
        "finished_at" = NOW(),
        "updated_at" = NOW()
      WHERE "namespace_id" = ${params.namespaceId}
      AND "id" = ${params.workflowRunId}
      AND "status" = 'running'
      AND "worker_id" = ${params.workerId}
      RETURNING "id"
    `;
    if (!updated) throw new Error("Failed to mark workflow run succeeded");
  }

  async markWorkflowRunFailed(
    params: MarkWorkflowRunFailedParams,
  ): Promise<void> {
    const [updated] = await this.pg`
      UPDATE "openworkflow"."workflow_runs"
      SET
        "status" = 'failed',
        "output" = NULL,
        "error" = ${this.pg.json(params.error)},
        "worker_id" = ${params.workerId},
        "available_at" = NULL,
        "finished_at" = NOW(),
        "updated_at" = NOW()
      WHERE "namespace_id" = ${params.namespaceId}
      AND "id" = ${params.workflowRunId}
      AND "status" = 'running'
      AND "worker_id" = ${params.workerId}
      RETURNING "id"
    `;
    if (!updated) throw new Error("Failed to mark workflow run failed");
  }

  async listStepAttempts(
    params: ListStepAttemptsParams,
  ): Promise<StepAttempt[]> {
    // limit to 200 for now
    return this.pg<StepAttempt[]>`
      SELECT *
      FROM "openworkflow"."step_attempts"
      WHERE "namespace_id" = ${params.namespaceId}
      AND "workflow_run_id" = ${params.workflowRunId}
      ORDER BY "created_at"
      LIMIT 200
    `;
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
        "started_at",
        "created_at",
        "updated_at"
      )
      VALUES (
        ${params.namespaceId},
        gen_random_uuid(),
        ${params.workflowRunId},
        ${params.stepName},
        ${params.kind},
        'running',
        NOW(),
        NOW(),
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
      WHERE "namespace_id" = ${params.namespaceId}
      AND "id" = ${params.stepAttemptId}
      LIMIT 1
    `;
    return stepAttempt ?? null;
  }

  async markStepAttemptSucceeded(
    params: MarkStepAttemptSucceededParams,
  ): Promise<void> {
    const [updated] = await this.pg`
      UPDATE "openworkflow"."step_attempts" sa
      SET
        "status" = 'succeeded',
        "output" = ${this.pg.json(params.output)},
        "error" = NULL,
        "finished_at" = NOW(),
        "updated_at" = NOW()
      FROM "openworkflow"."workflow_runs" wr
      WHERE sa."namespace_id" = ${params.namespaceId}
      AND sa."workflow_run_id" = ${params.workflowRunId}
      AND sa."id" = ${params.stepAttemptId}
      AND sa."status" = 'running'
      AND wr."namespace_id" = sa."namespace_id"
      AND wr."id" = sa."workflow_run_id"
      AND wr."status" = 'running'
      AND wr."worker_id" = ${params.workerId}
      RETURNING sa."id"
    `;
    if (!updated) throw new Error("Failed to mark step attempt succeeded");
  }

  async markStepAttemptFailed(
    params: MarkStepAttemptFailedParams,
  ): Promise<void> {
    const [updated] = await this.pg`
      UPDATE "openworkflow"."step_attempts" sa
      SET
        "status" = 'failed',
        "output" = NULL,
        "error" = ${this.pg.json(params.error)},
        "finished_at" = NOW(),
        "updated_at" = NOW()
      FROM "openworkflow"."workflow_runs" wr
      WHERE sa."namespace_id" = ${params.namespaceId}
      AND sa."workflow_run_id" = ${params.workflowRunId}
      AND sa."id" = ${params.stepAttemptId}
      AND sa."status" = 'running'
      AND wr."namespace_id" = sa."namespace_id"
      AND wr."id" = sa."workflow_run_id"
      AND wr."status" = 'running'
      AND wr."worker_id" = ${params.workerId}
      RETURNING sa."id"
    `;
    if (!updated) throw new Error("Failed to mark step attempt failed");
  }
}

/**
 * sqlDateDefaultNow returns the provided date or `NOW()` if not.
 * This is needed so we don't have to disable the eslint rule for every query.
 */
function sqlDateDefaultNow(pg: Postgres, date: Date | null) {
  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  return date ?? pg`NOW()`;
}
