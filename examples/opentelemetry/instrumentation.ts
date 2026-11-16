import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { UndiciInstrumentation } from "@opentelemetry/instrumentation-undici";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace";
import * as Sentry from "@sentry/node";
import { register } from "node:module";

// enable auto instrumentation of ESM imports like node:http
// https://github.com/open-telemetry/opentelemetry-js/blob/main/doc/esm-support.md#instrumentation-hook-required-for-esm
// oxlint-disable-next-line typescript/no-deprecated
register("@opentelemetry/instrumentation/hook.mjs", import.meta.url);

const sentryDsn = process.env["SENTRY_DSN"];
const sentryEndpoint = sentryDsn
  ? Sentry.getOtlpTracesEndpoint(sentryDsn)
  : undefined;

const sdk = new NodeSDK({
  serviceName: "example-opentelemetry",
  spanProcessors: [
    new BatchSpanProcessor({ exporter: new OTLPTraceExporter() }),
    ...(sentryEndpoint
      ? [
          new BatchSpanProcessor({
            exporter: new OTLPTraceExporter(sentryEndpoint),
          }),
        ]
      : []),
  ],
  instrumentations: [new HttpInstrumentation(), new UndiciInstrumentation()],
});
sdk.start();

Sentry.init({
  dsn: sentryDsn,
  integrations: [Sentry.openTelemetryIntegration()], // otel!
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
