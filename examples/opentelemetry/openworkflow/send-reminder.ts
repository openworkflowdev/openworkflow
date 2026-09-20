import { backend } from "./client.js";
import { defineWorkflow } from "openworkflow";

export const sendReminder = defineWorkflow<
  { emailUrl: string },
  { sent: boolean }
>({ name: "send-reminder" }, async ({ input, step, run }) => {
  await step.run({ name: "send-initial-email" }, async () => {
    const response = await fetch(input.emailUrl, { method: "POST" });
    return response.text();
  });

  await step.sleep("wait-2-seconds", "2s");

  return step.run(
    { name: "send-followup", retryPolicy: { maximumAttempts: 2 } },
    async () => {
      const { data: attempts } = await backend.listStepAttempts({
        workflowRunId: run.id,
      });
      if (
        attempts.filter((attempt) => attempt.stepName === "send-followup")
          .length === 1 // fail once per workflow run so you can see it in traces
      ) {
        throw new Error("Email service temporarily unavailable");
      }
      return { sent: true };
    },
  );
});
