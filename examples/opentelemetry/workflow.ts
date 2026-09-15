import { once } from "node:events";
import { createServer } from "node:http";
import { OpenWorkflow } from "openworkflow";
import { BackendSqlite } from "openworkflow/sqlite";

export async function runExample(): Promise<void> {
  // fake email server for the example
  const server = createServer((_request, response) => {
    response.end("sent");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No HTTP port");

  // ow setup
  const backend = BackendSqlite.connect(":memory:");
  const ow = new OpenWorkflow({ backend });

  let followupAttempts = 0;

  const sendReminder = ow.defineWorkflow(
    { name: "send-reminder" },
    async ({ step }) => {
      await step.run({ name: "send-initial-email" }, async () => {
        const response = await fetch(
          `http://127.0.0.1:${String(address.port)}/emails`,
          { method: "POST" },
        );
        return response.text();
      });

      await step.sleep("wait-2-seconds", "2s");

      return step.run(
        { name: "send-followup", retryPolicy: { maximumAttempts: 2 } },
        () => {
          // fail once to demonstrate a retry
          followupAttempts++;
          if (followupAttempts === 1)
            throw new Error("Email service temporarily unavailable");
          return { sent: true };
        },
      );
    },
  );
  const worker = ow.newWorker();

  try {
    const handle = await sendReminder.run();
    console.log(`Workflow run: ${handle.workflowRun.id}`);

    await worker.start();

    console.log("Awaiting result...");
    console.log("Result:", await handle.result({ timeoutMs: 30_000 }));
  } finally {
    await worker.stop();
    await backend.stop();

    server.close();
    await once(server, "close");
  }
}
