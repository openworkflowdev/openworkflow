import greetingDefaultWorkflow from "./openworkflow/greeting-default.js";
import { greetingWorkflow } from "./openworkflow/greeting.js";
import { addWorkflow, multiplyWorkflow } from "./openworkflow/math.js";
import { createClient } from "openworkflow";

const ow = await createClient();

// Greeting Workflow
console.log("Running greeting workflow...");
const greetingHandle = await ow.runWorkflow(greetingWorkflow.spec, {
  name: "Alice",
});
const greetingResult = await greetingHandle.result();
console.log("Greeting result:", greetingResult);

// Greeting Default Workflow
console.log("\nRunning greeting default workflow...");
const greetingDefaultHandle = await ow.runWorkflow(
  greetingDefaultWorkflow.spec,
  {
    name: "Alice",
  },
);
const greetingDefaultResult = await greetingDefaultHandle.result();
console.log("Greeting default result:", greetingDefaultResult);

// Math Workflows
console.log("\nRunning add workflow...");
const addHandle = await ow.runWorkflow(addWorkflow.spec, { a: 5, b: 3 });
const addResult = await addHandle.result();
console.log("Add result:", addResult);

console.log("\nRunning multiply workflow...");
const multiplyHandle = await ow.runWorkflow(multiplyWorkflow.spec, {
  a: 4,
  b: 7,
});
const multiplyResult = await multiplyHandle.result();
console.log("Multiply result:", multiplyResult);
