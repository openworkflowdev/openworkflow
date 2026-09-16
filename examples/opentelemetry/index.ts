/**
 * This file starts the example's HTTP server, worker, and fake email endpoint.
 * See ./openworkflow/send-reminder.ts for the actual workflow definition.
 */
import { backend, ow } from "./openworkflow/client.js";
import { sendReminder } from "./openworkflow/send-reminder.js";
import { createServer } from "node:http";

ow.implementWorkflow(sendReminder.spec, sendReminder.fn);
const worker = ow.newWorker();
await worker.start();

const port = Number(process.env["PORT"] ?? 3000);
const server = createServer((request, response) => {
  if (request.method === "POST" && request.url === "/workflows") {
    // POST /workflows (runs the sendReminder workflow)
    void ow
      .runWorkflow(sendReminder.spec, {
        emailUrl: `http://127.0.0.1:${String(port)}/emails`,
      })
      .then((handle) => {
        response.writeHead(202, { "Content-Type": "application/json" });
        return response.end(
          JSON.stringify({ workflowRunId: handle.workflowRun.id }),
        );
      })
      .catch((error: unknown) => {
        console.error(error);
        response.writeHead(500);
        response.end("Internal server error");
      });
  } else if (request.method === "POST" && request.url === "/emails") {
    // POST /emails (fake email server for the example)
    response.end("sent");
  } else {
    response.writeHead(404);
    response.end("Not found");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(
    `Create a workflow: curl -X POST http://127.0.0.1:${String(port)}/workflows`,
  );
  console.log(
    "View traces: http://localhost:18888/traces or in Sentry if configured.",
  );
});

const shutdown = async () => {
  await worker.stop();
  server.close(() => void backend.stop());
};
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
