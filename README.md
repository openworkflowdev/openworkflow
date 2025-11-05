# openworkflow

[![npm version](https://badge.fury.io/js/openworkflow.svg)](https://www.npmjs.com/package/openworkflow)
[![CI](https://img.shields.io/github/actions/workflow/status/openworkflowdev/openworkflow/ci.yaml)](https://github.com/openworkflowdev/openworkflow/actions/workflows/ci.yaml)

> **⚠️ In Development:** OpenWorkflow is in early development. Expect the first working version, v0.1, to be released on November 7.

OpenWorkflow is a WIP open-source TypeScript framework for building durable, resumable workflows.

Workflows can pause for seconds or months, survive crashes and deploys, and resume exactly where they stopped, all powered by a pluggable provider layer (PostgreSQL first, Valkey & others soon).

## Example

```ts
// Define a workflow to summarize documents
const summarizeDoc = workflow("summarizeDoc", async ({ input, step }) => {
  const extracted = await step.run("extractText", async () => {
    // Extract text from the document
    console.log(input.docUrl);
  });

  const cleaned = await step.run("cleanText", async () => {
    // Remove boilerplate, signatures, etc.
  });

  const summarized = await step.run("summarizeText", async () => {
    // Call OpenAI / LLM for summary
  });

  const summaryId = await step.run("saveSummary", async () => {
    // Save summary + metadata in DB
  });

  return summaryId;
});

// Run the workflow
const run = await summarizeDoc.run({
  docUrl: "https://example.com/mydoc.pdf",
});

// Wait for result (optional)
const result = await run.result(); // result === summaryId
```

## Roadmap

**In Progress:**

- Initial implementation with PostgreSQL provider & background worker
- `Provider` interface for implementing custom providers like Redis, etc.

**Future:**

- Signals / hooks
- Workflow versioning
- User project scaffolding
- Publish a spec
- Create implementations in other languages using the spec
