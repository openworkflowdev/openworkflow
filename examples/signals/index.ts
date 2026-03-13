import { BackendPostgres } from "@openworkflow/backend-postgres";
import { randomUUID } from "node:crypto";
import { OpenWorkflow, SignalTimeoutError } from "openworkflow";

const databaseUrl = "postgresql://postgres:postgres@localhost:5432/postgres";
const backend = await BackendPostgres.connect(databaseUrl, {
  namespaceId: randomUUID(),
});
const ow = new OpenWorkflow({ backend });

interface ApprovalRequest {
  documentId: string;
  requestedBy: string;
}

interface ApprovalSignal {
  approved: boolean;
  reviewedBy: string;
  comment?: string;
}

interface ApprovalResult {
  documentId: string;
  status: "approved" | "rejected" | "timed-out";
  reviewedBy?: string | undefined;
  comment?: string | undefined;
}

/**
 * An approval workflow that pauses and waits for an external signal before
 * continuing. Demonstrates step.waitForSignal() with an optional timeout.
 */
const approvalWorkflow = ow.defineWorkflow<ApprovalRequest, ApprovalResult>(
  { name: "approval-workflow" },
  async ({ input, step }) => {
    // Simulate sending a notification to a reviewer
    await step.run({ name: "send-notification" }, () => {
      console.log(
        `Notification sent to reviewer for document "${input.documentId}" (requested by ${input.requestedBy})`,
      );
    });

    // Pause and wait for an external approval signal (timeout after 10 seconds
    // for demo purposes; in production this would be hours or days)
    let approval: ApprovalSignal;
    try {
      approval = await step.waitForSignal<ApprovalSignal>("approval-decision", {
        timeout: "10s",
      });
    } catch (error) {
      if (error instanceof SignalTimeoutError) {
        console.log("No approval received within timeout — auto-rejecting.");
        return {
          documentId: input.documentId,
          status: "timed-out",
        };
      }
      throw error;
    }

    // Continue processing based on the signal payload
    const result = await step.run({ name: "process-decision" }, () => {
      const status = approval.approved ? "approved" : "rejected";
      console.log(
        `Document "${input.documentId}" ${status} by ${approval.reviewedBy}` +
          (approval.comment ? `: "${approval.comment}"` : ""),
      );
      return {
        documentId: input.documentId,
        status: status as ApprovalResult["status"],
        reviewedBy: approval.reviewedBy,
        comment: approval.comment,
      };
    });

    return result;
  },
);

async function main() {
  const worker = ow.newWorker({ concurrency: 2 });
  await worker.start();
  console.log("Worker started.\n");

  // --- Demo 1: signal arrives in time ---
  console.log("=== Demo 1: Signal arrives in time ===");
  const handle1 = await approvalWorkflow.run({
    documentId: "doc-001",
    requestedBy: "alice",
  });
  console.log(`Workflow started: ${handle1.workflowRun.id}`);

  // Wait a moment for the workflow to reach the waitForSignal step
  await sleep(500);

  // Send the approval signal from outside the workflow
  const signalResult = await handle1.sendSignal("approval-decision", {
    approved: true,
    reviewedBy: "bob",
    comment: "Looks good!",
  } satisfies ApprovalSignal);
  console.log(`Signal delivered: ${JSON.stringify(signalResult)}`);

  const result1 = await handle1.result();
  console.log(`Result: ${JSON.stringify(result1)}\n`);

  // --- Demo 2: timeout elapses before signal arrives ---
  console.log("=== Demo 2: Timeout (no signal sent) ===");
  const handle2 = await approvalWorkflow.run({
    documentId: "doc-002",
    requestedBy: "charlie",
  });
  console.log(`Workflow started: ${handle2.workflowRun.id}`);
  console.log("Waiting for timeout (10s)...");

  const result2 = await handle2.result({ timeoutMs: 30_000 });
  console.log(`Result: ${JSON.stringify(result2)}\n`);

  // --- Demo 3: sendSignal via ow.sendSignal() with a run ID ---
  console.log("=== Demo 3: sendSignal via ow.sendSignal() ===");
  const handle3 = await approvalWorkflow.run({
    documentId: "doc-003",
    requestedBy: "diana",
  });
  console.log(`Workflow started: ${handle3.workflowRun.id}`);

  await sleep(500);

  // Use the top-level ow.sendSignal() instead of handle.sendSignal()
  const signalResult3 = await ow.sendSignal(
    handle3.workflowRun.id,
    "approval-decision",
    {
      approved: false,
      reviewedBy: "eve",
      comment: "Needs revision.",
    } satisfies ApprovalSignal,
  );
  console.log(`Signal delivered: ${JSON.stringify(signalResult3)}`);

  const result3 = await handle3.result();
  console.log(`Result: ${JSON.stringify(result3)}\n`);

  console.log("Stopping worker...");
  await worker.stop();
  await backend.stop();
  console.log("Done.");
}

await main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
