# OpenWorkflow

[![npm](https://img.shields.io/npm/v/openworkflow)](https://www.npmjs.com/package/openworkflow)
[![build](https://img.shields.io/github/actions/workflow/status/openworkflowdev/openworkflow/ci.yaml)](https://github.com/openworkflowdev/openworkflow/actions/workflows/ci.yaml)
[![coverage](https://img.shields.io/codecov/c/github/openworkflowdev/openworkflow)](https://codecov.io/github/openworkflowdev/openworkflow)

OpenWorkflow is a TypeScript framework for building durable, resumable workflows
that can pause for seconds or months, survive crashes and deploys, and resume
exactly where they left off - all without extra servers to manage.

Define a workflow in a few lines:

```ts
import { BackendSqlite } from "@openworkflow/backend-sqlite";
import { OpenWorkflow } from "openworkflow";

const backend = BackendSqlite.connect("openworkflow/backend.db");
const ow = new OpenWorkflow({ backend });

const sendWelcomeEmail = ow.defineWorkflow(
  { name: "send-welcome-email" },
  async ({ input, step }) => {
    const user = await step.run({ name: "fetch-user" }, async () => {
      return await db.users.findOne({ id: input.userId });
    });

    await step.run({ name: "send-email" }, async () => {
      return await resend.emails.send({
        from: "me@example.com",
        to: user.email,
        replyTo: "me@example.com",
        subject: "Welcome!",
        html: "<h1>Welcome to our app!</h1>",
      });
    });

    await step.run({ name: "mark-welcome-email-sent" }, async () => {
      await db.users.update(input.userId, { welcomeEmailSent: true });
    });

    return { user };
  },
);
```

> OpenWorkflow is in active development and moving quickly. Check out the
> [Roadmap](#roadmap) for what’s coming next.

## Quick Start

Prerequisites:

- Node.js
- PostgreSQL (and/or SQLite)

### 1. Install

Install and set up OpenWorkflow with:

```bash
npx @openworkflow/cli init
```

The CLI will prompt for your backend, installs dependencies, and generates:
`openworkflow.config.{ts,js}`, `openworkflow/hello-world.{ts,js}`, `.env`,
`.gitignore`, and a `worker` script.

### 2. Start a worker

```bash
npx @openworkflow/cli worker start
```

This runs the worker using `openworkflow.config.{ts,js}` and auto-loads
workflows from the configured directories (default: `openworkflow/`).

### 3. Run workflows from your app

Create a file to trigger your workflow:

```ts
// trigger.ts
import { helloWorld } from "./openworkflow/hello-world.js";
import { BackendSqlite } from "@openworkflow/backend-sqlite";
import { OpenWorkflow } from "openworkflow";

const backend = BackendSqlite.connect("openworkflow/backend.db");
const ow = new OpenWorkflow({ backend });

// Run the workflow
const handle = await ow.runWorkflow(helloWorld.spec, {});

// Wait for the result
const result = await handle.result();
console.log(result); // { greeting: "Hello, World!" }
```

That's it. Your workflow is now durable, resumable, and fault-tolerant.

### 4. View workflows in the dashboard

View your workflows using the built-in dashboard:

```bash
npx @openworkflow/cli dashboard
```

The dashboard provides a UI for monitoring workflow runs, viewing step details, and inspecting workflow state.

## Core Concepts

### Workflows

Workflows are durable functions. They can contain multiple steps, make external
API calls, query databases, and perform complex logic. If a workflow is
interrupted (crash, deploy, server restart), it resumes from its last completed
step.

```ts
const workflow = ow.defineWorkflow(
  { name: "my-workflow" },
  async ({ input, step }) => {
    // Your workflow logic here
    return result;
  },
);
```

### Steps

Steps are the building blocks of workflows. Each step is executed exactly once
and its result is memoized. Steps let you break workflows into checkpoints.

```ts
const result = await step.run({ name: "step-name" }, async () => {
  // This function runs once. If the workflow restarts,
  // this returns the cached result instead of re-running.
  return await someAsyncWork();
});
```

**Why steps matter**: Imagine a workflow that charges a credit card, then sends
an email. Without steps, if your server crashes after charging the card, the
workflow would retry from the beginning and charge the customer twice. With
steps, the charge is memoized. The retry skips it and goes straight to sending
the email.

### Workers

Workers are long-running processes that poll your database for pending workflows
and execute them. Run workers via the CLI so workflow discovery stays in sync
with your `openworkflow.config.{ts,js}`:

```bash
npx @openworkflow/cli worker start
```

Or, for more control, you can write your own workers:

```ts
import { BackendSqlite } from "@openworkflow/backend-sqlite";
import { OpenWorkflow } from "openworkflow";

const backend = BackendSqlite.connect("openworkflow/backend.db");
const ow = new OpenWorkflow({ backend });

const worker = ow.newWorker({ concurrency: 20 });
await worker.start();

// & to shut down...
await worker.stop(); // waits for in-flight workflows to complete
```

Workers are stateless. They can be started, stopped, and deployed independently.
Your database is the source of truth.

### How it Works

1. **Your app starts a workflow**: A row is inserted into the `workflow_runs`
   table with status `pending`.
2. **A worker picks it up**: The worker polls the database, claims the workflow,
   and sets its status to `running`.
3. **The worker executes steps**: Each step is recorded in the `step_attempts`
   table. If a step succeeds, its result is cached.
4. **The workflow completes**: The worker updates the `workflow_run` status to
   `completed` or `failed`.
5. **If the worker crashes**: The workflow becomes visible to other workers via
   a heartbeat timeout. Another worker picks it up, loads the cached step
   results, and resumes from the next step.

## Advanced Patterns

### Parallel Steps

Run multiple steps concurrently using `Promise.all`:

```ts
const [user, subscription, settings] = await Promise.all([
  step.run({ name: "fetch-user" }, async () => {
    await db.users.findOne({ id: input.userId });
  }),
  step.run({ name: "fetch-subscription" }, async () => {
    await stripe.subscriptions.retrieve(input.subId);
  }),
  step.run({ name: "fetch-settings" }, async () => {
    await db.settings.findOne({ userId: input.userId });
  }),
]);
```

Each step is still memoized individually. If the workflow crashes mid-execution,
completed steps return instantly on resume.

### Automatic Retries

Steps can retry automatically with exponential backoff:

```ts
const data = await step.run({ name: "fetch-external-api" }, async () => {
  // If this throws, the step retries automatically
  return await externalAPI.getData();
});
```

Configure retry behavior at the workflow or step level (coming soon) or handle
errors explicitly in your step functions.

### Sleeping (Pausing) Workflows

You can pause a workflow until a future time and, because sleeping releases the
worker slot, you can pause thousands of workflows without tying up compute:

```ts
// Pause for 1 hour (durable, non-blocking)
await step.sleep("wait-one-hour", "1h");
```

The sleep step is memoized after it completes. If the workflow is replayed again
(e.g. due to a later retry) the completed sleep is not re-applied.

#### Duration Formats

Durations accept a number followed by a unit:

| Unit         | Aliases               | Examples         |
| ------------ | --------------------- | ---------------- |
| milliseconds | `ms`, `msec`, `msecs` | `100ms`, `1.5ms` |
| seconds      | `s`, `sec`, `secs`    | `5s`, `0.25s`    |
| minutes      | `m`, `min`, `mins`    | `2m`, `1.5m`     |
| hours        | `h`, `hr`, `hrs`      | `1h`, `0.25h`    |
| days         | `d`, `day(s)`         | `1d`, `0.5d`     |
| weeks        | `w`, `week(s)`        | `1w`, `2w`       |
| months       | `mo`, `month(s)`      | `1mo`, `2mo`     |
| years        | `y`, `yr`, `yrs`      | `1y`, `2yr`      |

See more examples of accepted duration formats and aliases in the
[tests](https://github.com/openworkflowdev/openworkflow/blob/main/packages/openworkflow/core/duration.test.ts).

### Type Safety

Workflows are fully typed. Define input and output types for compile-time
safety:

```ts
interface ProcessOrderInput {
  orderId: string;
  userId: string;
}

interface ProcessOrderOutput {
  paymentId: string;
  shipmentId: string;
}

const processOrder = ow.defineWorkflow<ProcessOrderInput, ProcessOrderOutput>(
  { name: "process-order" },
  async ({ input, step }) => {
    // input is typed as ProcessOrderInput
    // return type must match ProcessOrderOutput
    return { paymentId: "...", shipmentId: "..." };
  },
);
```

### Waiting for Results

You can wait for a workflow to complete and get its result:

```ts
const run = await myWorkflow.run({ data: "..." });

// Wait for the workflow to finish (polls the database)
const result = await run.result();
```

### Canceling Workflows

You can cancel a workflow that is pending, running, or sleeping to prevent a
workflow from continuing on to the next step:

```ts
const handle = await myWorkflow.run({ data: "..." });

// Cancel the workflow
await handle.cancel();
```

### Workflow Versioning

When you need to change workflow logic, use versioning for backwards
compatibility.

Define a workflow with an optional version:

```ts
const workflow = ow.defineWorkflow(
  { name: "my-workflow", version: "v2" },
  async ({ input, step, version }) => {
    if (version === "v2") {
      // v2 runs go here
      await step.run({ name: "new-step" }, async () => {
        // legacy logic
      });
    } else {
      // v1 runs go here
      await step.run({ name: "old-step" }, async () => {
        // ...
      });
    }
  },
);
```

### Validating Workflow Inputs

You can require `.run()` callers to provide specific inputs by supplying a
`schema` when defining the workflow. The schema is evaluated before the run is
enqueued, so invalid requests fail immediately.

```ts
import { z } from "zod";

const summarizeDoc = ow.defineWorkflow(
  {
    name: "summarize",
    schema: z.object({
      docUrl: z.string().url(),
    }),
  },
  async ({ input, step }) => {
    // `input` has type { docUrl: string }
  },
);

// Throws before enqueueing the workflow because the input isn't a URL
await summarizeDoc.run({ docUrl: "not-a-url" });
```

Any validator function works as long as it throws on invalid data (great for
custom logic or lightweight checks). Libraries such as Zod, ArkType, Valibot,
and Yup.

## Production Checklist

- **Database**: Use a production-ready Postgres instance
- **Workers**: Run at lease one worker process
- **Concurrency**: Start with `concurrency: 10` per worker and tune based on
  your workload
- **Monitoring**: Log worker activity and set up alerts for failed workflows
- **Graceful Shutdown**: Handle `SIGTERM` to ensure clean deploys:
  ```ts
  process.on("SIGTERM", async () => {
    await worker.stop();
    process.exit(0);
  });
  ```
- **Namespaces** (optional): Use `namespaceId` in your backend configuration to
  isolate workflows per environment:
  ```ts
  const backend = await BackendPostgres.connect(postgresUrl, {
    namespaceId: "production",
  });
  ```

## What's Next

- Read [ARCHITECTURE.md](./ARCHITECTURE.md) for a deep dive into how
  OpenWorkflow works
- Check [examples/](./examples) for working examples
- Star the repo and follow development on
  [GitHub](https://github.com/openworkflowdev/openworkflow)

## Roadmap

**Live in current `npm` release:**

- ✅ PostgreSQL and SQLite backends
- ✅ CLI (`npx @openworkflow/cli`)
- ✅ Dashboard (`npx @openworkflow/cli dashboard`)
- ✅ Worker with concurrency control
- ✅ Step memoization & retries
- ✅ Graceful shutdown
- ✅ Parallel step execution
- ✅ Sleeping (pausing) workflows
- ✅ Workflow versioning
- ✅ Workflow cancelation

**Coming Soon:**

- Idempotency keys
- Rollback / compensation functions
- Configurable retry policies
- Signals for external events
- Native OpenTelemetry integration
- Additional backends (Redis)
- Additional languages (Go, Python)

## Bugs & feature requests

Found a bug or have a feature request? Please open an issue on GitHub so we can
track and prioritize it:
https://github.com/openworkflowdev/openworkflow/issues/new
