# openworkflow

> **⚠️ In Development:** OpenWorkflow is in early development. Expect the first working version, v0.1, to be released on November 29.

OpenWorkflow is a WIP open-source TypeScript framework for building durable, resumable workflows.

Workflows can pause for seconds or months, survive crashes and deploys, and resume exactly where they stopped, all powered by a pluggable provider layer (PostgreSQL first, Valkey & others soon).

## Example

```ts
// Define a workflow to summarize documents
const summarizeDoc = defineWorkflow("summarizeDoc", async ({ run, step }) => {
  const text = await step.run("extractText", async () => {
    // 1. Extract text from uploaded PDF or doc
    console.log(run.input.docURL);
  });

  const cleaned = await step.run("cleanText", async () => {
    // 2. Remove boilerplate, signatures, etc.
  });

  const aiSummary = await step.run("generateSummary", async () => {
    // 3. Call OpenAI / LLM for summary
  });

  const summary = await step.run("storeResult", async () => {
    // 4. Save summary + metadata in DB
  });

  return summary;
});

// Start the workflow
const run = await startWorkflow(summarizeDoc, {
  docURL: "https://example.com/mydoc.pdf",
});

// Wait for result (optional)
const runResult = await run.result();
```

## Roadmap

**In Progress:**

- Initial implementation with PostgreSQL provider & background worker
- `Provider` interface for implementing custom providers like Redis, etc.

**Future:**

- User project scaffolding
- Publish a spec
- Create implementations in other languages using the spec
