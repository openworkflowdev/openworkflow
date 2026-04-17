# @openworkflow/backend-postgres

## 0.6.3

### Patch Changes

- Deprecate this package. It has moved into `openworkflow` core — import
  `BackendPostgres` from `openworkflow/postgres` or `BackendSqlite` from
  `openworkflow/sqlite` instead. A runtime warning is now emitted on import, and
  the peer dependency range is widened to include `openworkflow` v0.9.0. This
  package will be removed in a future release.

## 0.6.2

- Add support for `openworkflow` v0.8.0

## 0.6.1

- Add support for `openworkflow` v0.7.0

## 0.6.0

- This package is now a thin compatibility shim. Prefer importing
  `BackendPostgres` from `openworkflow/postgres`.

## 0.5.1

- Change listWorkflowRuns to DESC ordering

See the [openworkflow CHANGELOG](https://github.com/openworkflowdev/openworkflow/blob/main/packages/openworkflow/CHANGELOG.md) for details.
