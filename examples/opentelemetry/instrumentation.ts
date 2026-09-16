import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { UndiciInstrumentation } from "@opentelemetry/instrumentation-undici";
import { NodeSDK } from "@opentelemetry/sdk-node";
import * as Sentry from "@sentry/node-core/light";
import { otlpIntegration } from "@sentry/node-core/light/otlp";
import { register } from "node:module";

// enable auto instrumentation of ESM imports like node:http
// https://github.com/open-telemetry/opentelemetry-js/blob/main/doc/esm-support.md#instrumentation-hook-required-for-esm
// oxlint-disable-next-line typescript/no-deprecated
register("@opentelemetry/instrumentation/hook.mjs", import.meta.url);

const sdk = new NodeSDK({
  serviceName: "example-opentelemetry",
  traceExporter: new OTLPTraceExporter(),
  instrumentations: [new HttpInstrumentation(), new UndiciInstrumentation()],
});
sdk.start();

Sentry.init({
  dsn: process.env["SENTRY_DSN"],
  integrations: [otlpIntegration()], // otel!
});

// manually shutdown to flush the telemetry
process.once("beforeExit", () => void shutdown());
async function shutdown(): Promise<void> {
  try {
    await sdk.shutdown();
  } catch (error) {
    console.warn("Could not export traces:", error);
  } finally {
    await Sentry.close(5000);
  }
}
