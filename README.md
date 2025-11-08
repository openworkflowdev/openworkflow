# OpenWorkflow

[![npm version](https://badge.fury.io/js/openworkflow.svg)](https://www.npmjs.com/package/openworkflow)
[![CI](https://img.shields.io/github/actions/workflow/status/openworkflowdev/openworkflow/ci.yaml)](https://github.com/openworkflowdev/openworkflow/actions/workflows/ci.yaml)

> **⚠️ In Development:** OpenWorkflow is in early development. Expect the first
> working version, v0.1, to be released on November 8.

OpenWorkflow is a TypeScript framework for building durable, resumable workflows
that can pause for seconds or months, survive crashes and deploys, and resume
exactly where they left off.

Write regular TypeScript code and OpenWorkflow + your database handle the rest.
Automatic retries, crash recovery, parallel execution, and zero-downtime
deploys.

```ts
const processOrder = ow.defineWorkflow(
  { name: "process-order" },
  async ({ input, step }) => {
    const payment = await step.run({ name: "charge-card" }, async () => {
      return await stripe.charges.create({ amount: input.amount });
    });

    const inventory = await step.run({ name: "reserve-items" }, async () => {
      return await db.inventory.reserve(input.items);
    });

    const shipment = await step.run({ name: "create-shipment" }, async () => {
      return await shippo.shipments.create({ items: inventory });
    });

    return { payment, shipment };
  },
);

// Start the workflow
const run = await processOrder.run({ amount: 10_000, items: ["widget"] });

// Optionally await the result, which waits for an async worker to complete the
// workflow.
const { payment, shipment } = await run.result();
```

## Quick Start

## Prerequisites

- Node.js
- PostgreSQL

### 1. Install

```bash
npm install openworkflow @openworkflow/backend-postgres
```

### 2. Define a workflow

```ts
import { BackendPostgres } from "@openworkflow/backend-postgres";
import { OpenWorkflow } from "openworkflow";

const backend = await BackendPostgres.connect(process.env.DATABASE_URL);
const ow = new OpenWorkflow({ backend });

const sendWelcomeEmail = ow.defineWorkflow(
  { name: "send-welcome-email" },
  async ({ input, step }) => {
    const user = await step.run({ name: "fetch-user" }, async () => {
      return await db.users.findOne({ id: input.userId });
    });

    const emailId = await step.run({ name: "send-email" }, async () => {
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

    return { emailId };
  },
);
```

### 3. Start a worker

Workers are background processes that execute your workflows. Start one in a
separate process or the same one as your app:

```ts
const worker = ow.newWorker({ concurrency: 10 });
await worker.start();
```

### 4. Run workflows from your app

Trigger workflows from your web server, API, or any application code:

```ts
// In your API route handler
app.post("/users/:id/welcome", async (req, res) => {
  // Run the workflow async and do not wait for the result
  const runHandle = await sendWelcomeEmail.run({ userId: req.params.id });
  res.json({ runId: runHandle.workflowRun.id });
});
```

That's it. Your workflow is now durable, resumable, and fault-tolerant.

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
and execute them. You can run multiple workers for high availability and scale.

```ts
const worker = ow.newWorker({ concurrency: 20 });
await worker.start();

// Graceful shutdown on SIGTERM
process.on("SIGTERM", async () => {
  await worker.stop(); // waits for in-flight workflows to complete
  process.exit(0);
});
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
   `succeeded` or `failed`.
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

Configure retry behavior at the workflow level (coming soon) or handle errors
explicitly in your step functions.

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
- **Namespaces** (optional): Use `namespaceId` to isolate workflows per
  environment:
  ```ts
  const ow = new OpenWorkflow({ backend, namespaceId: "production" });
  ```

## What's Next

- Read [ARCHITECTURE.md](./ARCHITECTURE.md) for a deep dive into how
  OpenWorkflow works
- Check [examples/](./examples) for working examples
- Star the repo and follow development on
  [GitHub](https://github.com/openworkflowdev/openworkflow)

## Roadmap

**v0.1:**

- ✅ PostgreSQL backend
- ✅ Worker with concurrency control
- ✅ Step memoization & retries
- ✅ Graceful shutdown
- ✅ Parallel step execution

**Coming Soon:**

- Workflow versioning
- Configurable retry policies
- Signals for external events
- Workflow cancellation
- Admin dashboard
- Additional backends (Redis, SQLite)
- Additional languages (Go, Python)
