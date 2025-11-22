# openworkflow

## 0.3.0

- Added workflow versioning to help evolve workflows safely over time.
- Added workflow cancellation so running workflows can now be cancelled safely.
- Improved duration handling and TypeScript type-safety for duration strings.
- Fix for edge case where finished workflow runs could be slept.

## 0.2.0

- Sleep workflows with `step.sleep(name, duration)`

## 0.1.0

- Initial release
