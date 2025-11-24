# openworkflow

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
