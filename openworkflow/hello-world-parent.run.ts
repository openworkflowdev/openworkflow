import { backend, ow } from "./client.js";
import { helloWorldParent } from "./hello-world-parent.js";

console.log("Running hello-world-parent workflow...");
const handle = await ow.runWorkflow(helloWorldParent.spec, {});

console.log("Waiting for result...");
const result = await handle.result();

console.log(`Workflow result: ${JSON.stringify(result, null, 2)}`);

await backend.stop();
