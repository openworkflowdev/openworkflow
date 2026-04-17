# @openworkflow/backend-sqlite

> **Deprecated.** This package has moved into `openworkflow` core and will be
> removed in a future release.

## Migration

Import `BackendSqlite` from `openworkflow/sqlite` directly:

```diff
- import { BackendSqlite } from "@openworkflow/backend-sqlite";
+ import { BackendSqlite } from "openworkflow/sqlite";
```

Then remove `@openworkflow/backend-sqlite` from your dependencies. No other
code changes are required — this package has been a thin re-export of
`openworkflow/sqlite` since v0.6.0.

See the [openworkflow README](https://github.com/openworkflowdev/openworkflow)
for current documentation.
