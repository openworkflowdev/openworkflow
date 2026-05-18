import { defineWorkflow } from "openworkflow";

interface FlakyPaymentInput {
  cartId: string;
  amountCents: number;
}

interface FlakyPaymentOutput {
  cartId: string;
  authorizationId: string;
  receiptId: string;
  attemptsForReserve: number;
}

const RESERVE_MAX_ATTEMPTS = 3;

// Module-scoped counter. Persists across the failure-then-resume cycle as long
// as the worker process is alive, so the step succeeds on the first attempt
// after `ow.resumeWorkflowRun` is called.
let reserveAttempt = 0;

/**
 * Demo workflow for the Resume feature.
 *
 * Flow:
 * 1. First run: "reserve-funds" throws on every attempt; the step's retry
 *    budget (RESERVE_MAX_ATTEMPTS) is exhausted, so the workflow run ends in
 *    `failed`. The downstream steps never run.
 * 2. Click "Resume Run" in the dashboard (or call `ow.resumeWorkflowRun(id)`).
 *    The failed step_attempt rows are dropped and the run is requeued.
 * 3. On the next worker tick, "validate-cart" is served from the cache (not
 *    re-executed); "reserve-funds" runs once more, the counter is now past
 *    RESERVE_MAX_ATTEMPTS so it returns successfully, and "confirm-payment"
 *    plus "send-receipt" proceed to completion.
 *
 * Note: this relies on `reserveAttempt` persisting in the worker process. If
 * you restart the worker between the failure and the resume, the counter
 * resets, so resume will fail again and you'll need to resume once more.
 */
export const flakyPayment = defineWorkflow<FlakyPaymentInput, FlakyPaymentOutput>(
  { name: "flaky-payment" },
  async ({ input, step, run }) => {
    console.log(`[run ${run.id}] flaky-payment for cart ${input.cartId}`);

    await step.run({ name: "validate-cart" }, () => {
      if (input.amountCents <= 0) {
        throw new Error("amountCents must be positive");
      }
    });

    const { authorizationId, attempts } = await step.run(
      {
        name: "reserve-funds",
        retryPolicy: {
          maximumAttempts: RESERVE_MAX_ATTEMPTS,
          initialInterval: "500ms",
        },
      },
      () => {
        reserveAttempt++;
        console.log(`reserve-funds attempt ${String(reserveAttempt)}`);

        if (reserveAttempt <= RESERVE_MAX_ATTEMPTS) {
          throw new Error(
            `simulated upstream 503 (attempt ${String(reserveAttempt)})`,
          );
        }

        console.log(
          `reserve-funds recovered on attempt ${String(reserveAttempt)} (after resume)`,
        );
        return {
          authorizationId: `auth_${input.cartId}_${String(Date.now())}`,
          attempts: reserveAttempt,
        };
      },
    );

    const receiptId = await step.run({ name: "confirm-payment" }, () => {
      console.log(`confirming with ${authorizationId}`);
      return `rcpt_${input.cartId}`;
    });

    await step.run({ name: "send-receipt" }, () => {
      console.log(`receipt ${receiptId} mailed`);
    });

    return {
      cartId: input.cartId,
      authorizationId,
      receiptId,
      attemptsForReserve: attempts,
    };
  },
);
