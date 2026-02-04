# openworkflow

## Unreleased

- Added support for scheduling workflow runs with a `Date` or duration string
  See https://openworkflow.dev/docs/workflows#scheduling-a-workflow-run

## 0.6.3

- Export the full Backend interface for third-party backends

## 0.6.2

- Fix pnpx (pnpm dlx) `ERR_PNPM_DLX_MULTIPLE_BINS`
  - This removes the undocumented/unused openworkflow -> @openworkflow/cli shim

## 0.6.1

- Exclude test and build files from published package

## 0.6.0

- Added `openworkflow/postgres` and `openworkflow/sqlite` entrypoints for
  backends. The `@openworkflow/backend-postgres` and
  `@openworkflow/backend-sqlite` packages remain as compatibility shims.
- Changed the `postgres` driver to be an optional peer dependency. Install it
  separately when using the PostgreSQL backend.

## 0.5.0

- **New Tooling:** Introduced the OpenWorkflow CLI (`@openworkflow/cli`) for
  easier project management.
- Added `defineWorkflowSpec` for declarative workflow definitions. This allows
  you to define the shape of a workflow (input/output types, name, schema)
  separately from its implementation.
- Added `deadlineAt` option to workflow definitions. This allows workflows to
  automatically fail if they exceed a specific duration (Thanks
  @Shobhit-Nagpal).

## 0.4.1

- Add SQLite backend (`@openworkflow/backend-sqlite`) using `node:sqlite`
  (requires Node.js 22+). This is now the recommended backend for non-production
  environments (@nathancahill)
- Add `declareWorkflow` and `implementWorkflow` APIs to separate workflow
  definitions from their implementation logic for tree-shaking
- Fix execution logic when running multiple versions of the same workflow on a
  single worker
- A reusable test suite (`@openworkflow/backend-test`) is now available for
  contributors building custom backend adapters. See the Postgres and SQLite
  backends for example usage.

## 0.4.0

- Add schema validation, compatible with over a dozen validators like Zod,
  Valibot, ArkType, and more. [Supported
  validators](https://standardschema.dev/#what-schema-libraries-implement-the-spec).
  (@mariusflorescu)
- Improve performance when replaying workflows with over 200 steps
- Deprecate `succeeded` status in favor of `completed` (backward compatible)

And for custom backend implementations:

- Add pagination to `listStepAttempts`
- Rename `Backend` methods to be verb-first (e.g. `markWorkflowRunFailed` →
  `failWorkflowRun`) and add `listWorkflowRuns`

## 0.3.0

- Added workflow versioning to help evolve workflows safely over time.
- Added workflow cancellation so running workflows can now be cancelled safely.
- Improved duration handling and TypeScript type-safety for duration strings.
- Fix for edge case where finished workflow runs could be slept.

## 0.2.0

- Sleep workflows with `step.sleep(name, duration)`

## 0.1.0

- Initial release
