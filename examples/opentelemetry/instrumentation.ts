import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { UndiciInstrumentation } from "@opentelemetry/instrumentation-undici";
import { NodeSDK } from "@opentelemetry/sdk-node";

export const sdk = new NodeSDK({
  serviceName: "example-opentelemetry",
  traceExporter: new OTLPTraceExporter(),
  instrumentations: [new UndiciInstrumentation()],
});
sdk.start();
