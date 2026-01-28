# @openworkflow/cli

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
