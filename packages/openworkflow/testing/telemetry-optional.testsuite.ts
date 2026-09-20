import { OpenWorkflow } from "../index.js";
import { BackendSqlite } from "../sqlite.js";
import { getOtelApi, SPAN_NAMES, traceOperation } from "../telemetry.js";
import assert from "node:assert/strict";

const backend = BackendSqlite.connect(":memory:");
const ow = new OpenWorkflow({ backend });
let calls = 0;
function callback() {
  calls++;
  return 42;
}
const workflow = ow.defineWorkflow({ name: "no-otel" }, async ({ step }) => {
  const value = await step.run({ name: "work" }, callback);
  await step.sleep("pause", "0ms");
  await step.sendSignal({ signal: "unmatched" });
  await step.waitForSignal({ signal: "approval", timeout: "0ms" });
  return value;
});
const worker = ow.newWorker();
try {
  assert.equal(await getOtelApi(), undefined);
  const canceled = await workflow.run();
  await canceled.cancel();
  await assert.rejects(canceled.result(), /was canceled/);
  const handle = await workflow.run();
  assert.equal(handle.workflowRun.context, null);
  await worker.start();
  assert.equal(await handle.result({ timeoutMs: 10_000 }), 42);
  assert.equal(calls, 1);
  assert.deepEqual(await ow.sendSignal({ signal: "unmatched" }), {
    workflowRunIds: [],
  });

  const error = new Error("original failure");
  let failures = 0;
  const failure = () => {
    failures++;
    return Promise.reject(error);
  };
  await assert.rejects(
    traceOperation(SPAN_NAMES.STEP_ATTEMPT_EXECUTE, {}, failure),
    (caught) => caught === error,
  );
  assert.equal(failures, 1);
} finally {
  await worker.stop();
  await backend.stop();
}
