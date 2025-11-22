import { BackendPostgres } from "@openworkflow/backend-postgres";
import { randomUUID } from "node:crypto";
import { OpenWorkflow } from "openworkflow";
import { object as yupObject, string as yupString } from "yup";

const databaseUrl = "postgresql://postgres:postgres@localhost:5432/postgres";
const backend = await BackendPostgres.connect(databaseUrl, {
  namespaceId: randomUUID(),
});
const ow = new OpenWorkflow({ backend });

const schema = yupObject({
  docUrl: yupString().url().required(),
  num: yupString().required(),
});

/**
 * An example workflow that extracts, cleans, summarizes, and saves a document
 * from a URL. It uses a Yup schema to validate the input.
 */
const summarizeDoc = ow.defineWorkflow(
  { name: "summarize-doc-yup", schema },
  async ({ input, step }) => {
    const extracted = await step.run({ name: "extract-text" }, () => {
      console.log(`[${input.num}] Extracting text from ${input.docUrl}`);
      return "extracted-text";
    });

    const cleaned = await step.run({ name: "clean-text" }, () => {
      console.log(
        `[${input.num}] Cleaning ${String(extracted.length)} characters`,
      );
      return "cleaned-text";
    });

    const summarized = await step.run({ name: "summarize-text" }, async () => {
      console.log(`[${input.num}] Summarizing: ${cleaned.slice(0, 10)}...`);

      // sleep a bit to simulate async work
      await randomSleep();

      // fail 50% of the time to demonstrate retries
      // eslint-disable-next-line sonarjs/pseudo-random
      if (Math.random() < 0.5) {
        console.log(`[${input.num}] ⚠️ Simulated failure during summarization`);
        throw new Error("Simulated summarization error");
      }

      return "summary";
    });

    const summaryId = await step.run({ name: "save-summary" }, async () => {
      console.log(
        `[${input.num}] Saving summary (${summarized}) to the database`,
      );

      // sleep a bit to simulate async work
      await randomSleep();

      return randomUUID();
    });

    return {
      summaryId,
      summarized,
    };
  },
);

/**
 * Start a worker with 4 concurrency slots. Then create and run four workflows
 * concurrently with injected logging.
 *
 * This `main` function is much more complex and messy than a typical example.
 * You can find a more typical example in the README.
 */
async function main() {
  const n = 4;

  console.log("Starting worker...");
  const worker = ow.newWorker({ concurrency: n });
  await worker.start();

  console.log(`Running ${String(n)} workflows...`);
  const runCreatePromises = [] as Promise<unknown>[];
  for (let i = 0; i < n; i++) {
    runCreatePromises.push(
      summarizeDoc.run({
        docUrl: "https://example.com/mydoc.pdf",
        num: String(i + 1),
      }),
    );
    console.log(`Workflow run ${String(i + 1)} enqueued`);
  }

  // wait for all run handles to be created
  const runHandles = (await Promise.all(runCreatePromises)) as {
    result: () => ReturnType<typeof summarizeDoc.run>;
  }[];

  // collect result promises, attach logging to each
  const resultPromises = runHandles.map((h, idx) =>
    h
      .result()
      .then((output) => {
        console.log(
          `✅ Workflow run ${String(idx + 1)} succeeded: ${JSON.stringify(output)}`,
        );
        return { status: "fulfilled" as const, value: output };
      })
      .catch((error: unknown) => {
        console.error(`❌ Workflow run ${String(idx + 1)} failed:`, error);
        return { status: "rejected" as const, reason: error } as unknown;
      }),
  );

  // run all
  await Promise.all(resultPromises);

  console.log("Stopping worker...");
  await worker.stop();

  console.log("Closing backend...");
  await backend.stop();

  console.log("Done.");
}

await main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

function randomSleep() {
  // eslint-disable-next-line sonarjs/pseudo-random
  const sleepDurationMs = Math.floor(Math.random() * 1000) * 5;
  return new Promise((resolve) => setTimeout(resolve, sleepDurationMs));
}
