# openworkflow

#### Upcoming / unreleased

- Add `openworkflow` CLI (alias `ow`) for easy management:
  - `ow init`: Initialize new projects with backend selection (SQLite or Postgres)
  - `ow worker start`: Start a worker with automatic workflow discovery based on config
  - `ow doctor`: Verify environment and dependencies
- Add `openworkflow.config.ts` for declarative project configuration
- Add `defineWorkflowSpec` for declarative workflow definitions (deprecates `declareWorkflow`)
- Add timeout option to workflow definitions to automatically fail runs that exceed a specific duration (@Shobhit-Nagpal)

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
