# @openworkflow/backend-postgres

> **Deprecated.** This package has moved into `openworkflow` core and will be
> removed in a future release.

## Migration

Import `BackendPostgres` from `openworkflow/postgres` directly:

```diff
- import { BackendPostgres } from "@openworkflow/backend-postgres";
+ import { BackendPostgres } from "openworkflow/postgres";
```

Then remove `@openworkflow/backend-postgres` from your dependencies. No other
code changes are required — this package has been a thin re-export of
`openworkflow/postgres` since v0.6.0.

See the [openworkflow README](https://github.com/openworkflowdev/openworkflow)
for current documentation.
