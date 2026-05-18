import { backend, ow } from "./client.js";
import { flakyPayment } from "./flaky-payment.js";

console.log("Running flaky-payment workflow...");
console.log("Expected: 3 failed attempts -> workflow marked failed.");
console.log(
  "Then open http://localhost:3000, click 'Resume Run', and watch it complete.\n",
);

const handle = await ow.runWorkflow(flakyPayment.spec, {
  cartId: "cart_demo_1",
  amountCents: 4200,
});

console.log(`Run id: ${handle.workflowRun.id}`);
console.log("Waiting for first terminal state...");

try {
  const result = await handle.result();
  console.log(`Workflow completed: ${JSON.stringify(result, null, 2)}`);
} catch (error) {
  console.log("\nWorkflow failed (as expected on first pass):");
  console.log(error instanceof Error ? error.message : String(error));
  console.log(
    "\nNow click 'Resume Run' on the run detail page in the dashboard.",
  );
  console.log(
    "Leave the worker running so the in-memory attempt counter persists.",
  );
}

await backend.stop();
