import { sdk } from "./instrumentation.js";

try {
  // OTel must start before we import the workflow.
  const { runExample } = await import("./workflow.js");
  await runExample();
} finally {
  try {
    await sdk.shutdown();
    console.log("View traces: http://localhost:18888/traces");
  } catch (error) {
    console.warn(
      "Could not export traces:",
      error instanceof Error ? error.message : error,
    );
    console.warn(
      "Start Aspire to view traces with: docker compose up -d aspire",
    );
  }
}
