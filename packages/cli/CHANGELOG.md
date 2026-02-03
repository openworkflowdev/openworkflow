# @openworkflow/cli

## 0.3.0

- Update `init` templates to use `openworkflow/postgres` and
  `openworkflow/sqlite`. The CLI no longer installs the legacy backend
  packages.

## 0.2.3

- Ignore `*.run.*` in default generated config
- Add support for ignorePatterns

## 0.2.2

- Generate example run script on `ow init`

## 0.2.1

- `ow init`: Generate a client file to DRY up the client

## 0.2.0

- Add `openworkflow dashboard` command to launch the dashboard

## 0.1.0

- Initial release of the `openworkflow` CLI (alias `ow`).
  - `ow init`: Interactively initializes new projects, configuring the backend
    (SQLite/Postgres) and generating necessary boilerplate.
  - `ow worker start`: Starts a worker process with automatic workflow discovery
    based on `openworkflow.config.ts`.
  - `ow doctor`: Verifies environment configuration, dependencies, and lists
    discovered workflows.
