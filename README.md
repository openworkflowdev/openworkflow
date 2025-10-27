# openworkflow

> **⚠️ In Development:** OpenWorkflow is in early development. Expect the first working version, v0.1, to be released on November 29.

OpenWorkflow is a WIP open-source TypeScript framework for building durable, resumable workflows.

Workflows can pause for seconds or months, survive crashes and deploys, and resume exactly where they stopped, all powered by a pluggable provider layer (PostgreSQL first, Valkey & others soon).

## Roadmap

**In Progress:**

- Initial implementation with PostgreSQL provider & background worker
- `Provider` interface for implementing custom providers like Redis, etc.

**Future:**

- User project scaffolding
- Publish a spec
- Create implementations in other languages using the spec
