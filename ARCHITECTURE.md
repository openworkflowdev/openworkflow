# OpenWorkflow Architecture

## 1. Introduction & Core Concepts

### 1.1. What is OpenWorkflow?

OpenWorkflow is a framework for building reliable, long-running applications. It
allows developers to write durable functions, called **workflows**, that can
survive process crashes, server restarts, and code deploys.

It achieves this through a **worker-driven architecture**. Instead of relying on
a central orchestrator server, OpenWorkflow uses a pool of stateless **Workers**
that run within the user's infrastructure. These workers communicate with a
durable **Backend** (like a Postgres or SQLite database) which acts as the
single source of truth for all workflow state. This model provides the power of
durable execution with minimal operational complexity.

### 1.2. Taxonomy

- **Workflow**: A durable function that orchestrates multiple steps. Workflows
  are deterministic, resumable, and versioned.
- **Workflow Run**: A single, complete execution instance of a workflow, from
  start to finish. Each run is a state machine managed by the workers.
- **Step**: A durable, memoized checkpoint within a workflow. A step represents
  a unit of work, like a database query or an API call.
- **Step Attempt**: A record in the Backend representing the state and result of
  a single step attempt within a specific workflow run.
- **Worker**: A long-running process in the user's application that polls the
  Backend for pending workflows, executes their code, and persists the results.
- **Client**: The part of the OpenWorkflow SDK used by application code to start
  and query workflow runs.
- **Backend**: A pluggable persistence layer (e.g., a Postgres or SQLite
  database) that stores all state for workflow runs and step attempts. It serves
  as the queue and the durable state log.
- **Config**: `openworkflow.config.*` defines backend settings, workflow
  discovery paths, and optional ignore patterns for CLI commands. It typically
  imports the shared `backend` from `openworkflow/client.*` so app code and CLI
  use the same connection.
- **`availableAt`**: A critical timestamp on a workflow run that controls its
  visibility to workers. It is used for scheduling, heartbeating, crash
  recovery, and durable timers.
- **`deadlineAt`**: An optional timestamp on a workflow run that specifies the
  deadline by which the workflow must complete. If the deadline is reached, the
  workflow run is marked as failed.

### 1.3. Workflow Run Statuses

A workflow run can be in one of the following states:

- **`pending`**: The workflow run has been created and is waiting for a worker
  to claim it.
- **`running`**: The workflow run is actively being executed by a worker.
- **`sleeping`**: The workflow run is waiting for a duration to elapse
  (`step.sleep`). The `availableAt` timestamp controls when it becomes available
  again.
- **`completed`**: The workflow run has completed successfully.
- **`failed`**: The workflow run has failed after exhausting retries or deadline
  reached.
- **`canceled`**: The workflow run has been explicitly canceled and will not be
  processed further.

### 1.4. Step Attempt Statuses

A step attempt can be in one of the following states:

- **`running`**: The step attempt is currently being executed.
- **`completed`**: The step attempt completed successfully and its result is
  stored.
- **`failed`**: The step attempt failed. The workflow may create a new attempt
  if it retries.

## 2. System Architecture Overview

### 2.1. Architecture Diagram

OpenWorkflow uses a worker-driven model where the database is the central point
of coordination. There is no separate orchestrator server.

```
+---------------------------------+      +--------------------------------+
|                                 |      |                                |
|      Your Application Code      |      |      OpenWorkflow Worker       |
|      (e.g., a web server)       |      |      (Separate Process)        |
|                                 |      |                                |
|  +---------------------------+  |      |  +---------------------------+ |
|  |   OpenWorkflow Client     |  |      |  |   Workflow Definitions    | |
|  | (Creates Workflow Runs)   |  |      |  |                           | |
|  +---------------------------+  |      |  +---------------------------+ |
|               |                 |      |               |                |
+---------------+-----------------+      +---------------+----------------+
                |                                        |
                |     +----------------------------+     |
                +-----|  Backend Interface         |-----+
                      |  (e.g., Postgres / SQLIte) |
                      +----------------------------+
                                     |
                                     |
                      +------------------------------+
                      |                              |
                      |       Backend Storage        |
                      |                              |
                      | - workflow_runs              |
                      | - step_attempts              |
                      +------------------------------+
```

### 2.2. Core Components

- **Client**: The entry point for an application to interact with OpenWorkflow.
  It is responsible for creating new workflow runs by writing to the
  `workflow_runs` table in the Backend.
- **Worker**: The execution engine. It contains an in-memory registry of all
  defined workflow code. It continuously polls the `workflow_runs` table for
  available work, executes the workflow logic, and updates the Backend with the
  results.
- **CLI**: The dev tooling that scaffolds projects, writes
  `openworkflow.config.ts`, and runs workers via `ow worker start` with
  auto-discovery of workflow files.
- **Backend**: The source of truth. It stores workflow runs and step attempts.
  The `workflow_runs` table serves as the job queue for the workers, while the
  `step_attempts` table serves as a record of started and completed work,
  enabling memoization.

### 2.3. Basic Execution Flow

1.  **Workflow Registration**: A developer defines workflows in their code. When
    a Worker process starts, it automatically discovers and registers the
    workflow code based on `openworkflow.config.ts` (default `openworkflow/`
    directory). There is no sync process with an external server.
2.  **Workflow Invocation**: The application code uses the **Client** to start a
    new workflow run. The Client creates a new entry in the `workflow_runs`
    table with a `pending` status.
3.  **Job Polling**: A **Worker** process polls the `workflow_runs` table,
    looking for runs whose `availableAt` timestamp is in the past and whose
    status is either `pending` (new work), `sleeping` (but done), or `running`
    with an expired lease. It uses an atomic `FOR UPDATE SKIP LOCKED` query to
    claim a single workflow run, setting its status to `running` and extending
    the lease.
4.  **Code Execution (Replay Loop)**: The Worker loads the history of completed
    `step_attempts` for the claimed workflow. It then executes the workflow code
    from the beginning, using the history to memoize results of
    already-completed steps.
5.  **Step Processing**: When the Worker encounters a new step, it creates a
    `step_attempt` record with status `running`, executes the step function, and
    then updates the `step_attempt` to `completed` upon completion. The Worker
    continues executing inline until the workflow code completes or encounters a
    sleep.
6.  **State Update**: The Worker updates the Backend with each `step_attempt` as
    it is created and completed, and updates the status of the `workflow_run`
    (e.g., `completed`, `sleeping`).

## 3. The Execution Model: State Machine Replication

OpenWorkflow treats each workflow run as a state machine. The worker's job is to
advance the state of that machine from its last known checkpoint until the next
one.

### 3.1. The Replay Loop

When a worker claims a workflow run, it always executes the code from the
beginning. This is the core of the deterministic replay model.

```ts
// A worker claims a workflow run.
// It loads the step history and continues to the first step.

const user = await step.run({ name: "fetch-user" }, async () => {
  // 1. The framework sees "fetch-user".
  // 2. It finds a completed result in the history.
  // 3. It returns the cached output immediately without executing the function.
  return await db.users.findOne({ id: 1 });
});

const welcomeEmail = await step.run({ name: "welcome-email" }, async () => {
  // 4. The framework sees "welcome-email".
  // 5. It is NOT in the history.
  // 6. It creates a step_attempt with status "running".
  // 7. It executes the function and saves the result.
  // 8. It updates the step_attempt to status "completed" and continues.
  return await email.send(user);
});
```

### 3.2. Step Execution

All steps are executed synchronously by the worker. When a worker encounters a
new step:

1.  It creates a `step_attempt` record with status `running`.
2.  It executes the step function inline.
3.  Upon completion, it updates the `step_attempt` to status `completed` with
    the result.

Workers can be configured with a high concurrency limit (e.g., 100 or more) to
handle many workflow runs simultaneously. Each workflow run occupies a worker
slot for the duration of its execution, but this is acceptable given the high
concurrency capacity.

### 3.3. Available Step Types

The SDK provides several step primitives to handle different workflow patterns:

**`step.run(config, fn)`**: Executes a block of arbitrary code. This is the most
common step type used for database queries, API calls, and other synchronous
operations.

```ts
const user = await step.run({ name: "fetch-user" }, async () => {
  return await db.users.findOne({ id: userId });
});
```

**`step.sleep(name, duration)`**: Pauses the workflow until a specified time.
When encountered, the worker sets the workflow run's `status` to `sleeping` and
`availableAt` to the resume time, then releases the workflow. This frees up the
worker slot for other work - it's not a blocking sleep but a durable pause.

```ts
await step.sleep("wait-one-hour", "1h");
```

## 4. Error Handling & Retries

### 4.1. Step Failures & Retries

When a step's function throws an error, the framework records the error in the
`step_attempt` and sets its status to `failed`. The error then propagates up. If
the run is retryable, the entire workflow run is rescheduled with exponential
backoff by setting its `availableAt` timestamp to a future time. On the next
execution, the replay will reach the failed step and re-execute its function.

### 4.2. Workflow Failures & Retries

If an error is unhandled by the workflow code, the entire workflow run fails.
The workflow run is rescheduled with backoff. By default, retries continue
until canceled or until a configured deadline is reached. If the run can no
longer be retried (for example, because the next retry would exceed
`deadlineAt`), its status is set to `failed` permanently.

### 4.3. Workflow Deadlines

Workflow runs can include an optional `deadlineAt` timestamp, specifying the
time by which the workflow must complete. Steps and retries are skipped if they
would exceed the deadline, making the run permanently `failed`.

### 4.4. Workflow Cancelation

Workflows can be explicitly canceled at any time via the Client API:

```ts
const handle = await workflow.run({ "..." });
await handle.cancel();
```

**Handling cancelation during execution**: If a workflow is canceled while a
worker is actively processing it, the worker will detect the cancelation. The
worker will then stop further execution of the workflow code and mark the
workflow as `canceled`. This ensures that partial work from the canceled
workflow is not committed as a successful result.

## 5. Concurrency & Parallelism

### 5.1. Parallel Steps

The SDK supports parallel execution of steps via language-native constructs like
`Promise.all`.

```ts
const [user, settings] = await Promise.all([
  step.run({ name: "fetch-user" }, ...),
  step.run({ name: "fetch-settings" }, ...),
]);
```

When the worker encounters this, it executes all steps within the `Promise.all`
concurrently. It waits for all of them to complete before proceeding. Each step
attempt is persisted individually as a `step_attempt`.

### 5.2. Workflow Concurrency

Workers are configured with a concurrency limit (e.g., 10). A worker will
maintain up to 10 in-flight workflow runs simultaneously. It polls for new work
only when it has available capacity. The Backend's atomic `dequeue` operation
(`FOR UPDATE SKIP LOCKED`) ensures that multiple workers can poll the same table
without race conditions or processing the same run twice.

### 5.3. Handling Crashes During Parallel Execution

The `availableAt` heartbeat mechanism provides robust recovery. If a worker
crashes while executing parallel steps, its heartbeat stops. The `availableAt`
for the workflow run expires, and another worker claims it. The new worker
replays the workflow: any steps that completed before the crash will return
their cached output instantly; any that were in-flight will be re-executed.

## 6. Versioning

### 6.1. The Challenge of Deterministic Replay

If a workflow's code is changed while runs are in-flight, the deterministic
replay can break. For example, renaming a step will cause the replaying worker
to fail because the step ID in the history no longer matches the step ID in the
new code.

### 6.2. Code-Based Versioning

Workflows can be made version-aware using conditional logic to handle different
historical paths within the workflow code. The workflow receives a `version`
parameter that can be used to determine which code path to execute.

```ts
const workflow = ow.defineWorkflow({ name: "versioned-workflow" }, async ({ step, version }) => {
  if (version === "v1") {
  await step.run({ name: "old-step-name" }, ...);
  } else {
  await step.run({ name: "new-step-name" }, ...);
  }
});
```

This approach enables zero-downtime deployments by allowing old workflow runs to
replay correctly on their original version while new runs use the updated code
path.

## 7. Workers

### 7.1. Responsibilities

Workers are the stateless engines of the OpenWorkflow system. They are
responsible for:

- Polling the Backend for available workflow runs.
- Executing workflow code using the deterministic replay model.
- Managing a concurrency pool to process multiple runs simultaneously.
- Periodically heartbeating to maintain their claim on active runs.
- Handling errors and implementing retry logic with backoff.
- Gracefully shutting down to ensure no work is lost during deploys.

### 7.2. The Heartbeat and `availableAt` Mechanism

The `availableAt` timestamp is the core of the system's fault tolerance.

1.  When a worker claims a run, it sets `availableAt` to `NOW() +
visibilityTimeout`.
2.  It must periodically `UPDATE` this timestamp before the timeout expires to
    maintain its lock. This is the heartbeat.
3.  If a worker crashes, its heartbeats stop.
4.  The `availableAt` timestamp expires, and the `workflow_run` becomes visible
    to other workers' polling queries again.
5.  Another worker claims the run and initiates recovery.

### 7.3. Graceful Shutdown

When a worker receives a shutdown signal (e.g., `SIGTERM`), it initiates a
graceful shutdown:

1.  It stops polling for new workflow runs.
2.  It waits for all its currently active workflow runs to complete their
    current execution slice and be safely persisted back to the Backend.
3.  Once all in-flight work is finished, the worker process exits.

## 8. Package/Folder Structure

- `packages/openworkflow` contains the SDK (client, worker, registry).
- `packages/backend-postgres` and `packages/backend-sqlite` are infra-specific
  `Backend` implementations.
- `packages/cli` is the CLI.
- `packages/dashboard` is the web UI for monitoring workflow runs.
