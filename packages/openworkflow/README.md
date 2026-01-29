# OpenWorkflow

[![npm](https://img.shields.io/npm/v/openworkflow)](https://www.npmjs.com/package/openworkflow)
[![build](https://img.shields.io/github/actions/workflow/status/openworkflowdev/openworkflow/ci.yaml)](https://github.com/openworkflowdev/openworkflow/actions/workflows/ci.yaml)
[![coverage](https://img.shields.io/codecov/c/github/openworkflowdev/openworkflow)](https://codecov.io/github/openworkflowdev/openworkflow)

OpenWorkflow is a TypeScript framework for building durable, resumable workflows
that can pause for seconds or months, survive crashes and deploys, and resume
exactly where they left off - all without extra servers to manage.

```ts
import { defineWorkflow } from "openworkflow";

export const sendWelcomeEmail = defineWorkflow(
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

## Quick Start

**Prerequisites:** Node.js & PostgreSQL (or SQLite)

### Install

```bash
npx @openworkflow/cli init
```

The CLI will guide you through setup and generate everything you need to get
started.

For more details, check out our [docs](https://openworkflow.dev/docs).

## Features

- ✅ **Durable** - Workflows survive crashes and deploys
- ✅ **Resumable** - Pick up exactly where you left off
- ✅ **Type-safe** - Full TypeScript support
- ✅ **Step memoization** - Never repeat completed work
- ✅ **Automatic retries** - Built-in exponential backoff
- ✅ **Long pauses** - Sleep for seconds or months
- ✅ **Parallel execution** - Run steps concurrently
- ✅ **No extra servers** - Uses your existing database
- ✅ **Dashboard included** - Monitor and debug workflows
- ✅ **Production ready** - PostgreSQL and SQLite support

## Documentation

- [Documentation](https://openworkflow.dev/docs)
- [Quick Start Guide](https://openworkflow.dev/docs/quickstart)
- [Core Concepts](https://openworkflow.dev/docs/core-concepts)
- [Advanced Patterns](https://openworkflow.dev/docs/advanced-patterns)
- [Production Checklist](https://openworkflow.dev/docs/production)

## Architecture

Read
[ARCHITECTURE.md](https://github.com/openworkflowdev/openworkflow/blob/main/ARCHITECTURE.md)
for a deep dive into how OpenWorkflow works under the hood.

## Examples

Check out
[examples/](https://github.com/openworkflowdev/openworkflow/tree/main/examples)
for working examples.

## Contributing

We welcome contributions! Please read
[CONTRIBUTING.md](https://github.com/openworkflowdev/openworkflow/blob/main/CONTRIBUTING.md)
before submitting a pull request.

## Community

- [GitHub Issues](https://github.com/openworkflowdev/openworkflow/issues) -
  Report bugs and request features
- [Roadmap](https://openworkflow.dev/docs/roadmap) - See what's coming next
