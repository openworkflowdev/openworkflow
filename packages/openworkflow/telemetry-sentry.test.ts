import { execFile } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";

const execFileAsync = promisify(execFile);

// The root dependency supplies Sentry's optional SDK 2 exporter peer.
describe("OpenTelemetry example", () => {
  test("exports example spans through OTLP and Sentry", async () => {
    const destinations = new Set<string>();
    const server = createServer((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk: string) => {
        body += chunk;
      });
      request.on("end", () => {
        if (body.includes("otel-sentry-regression")) {
          destinations.add(request.url ?? "");
        }
        response.writeHead(200, { "content-type": "application/json" });
        response.end("{}");
      });
    });
    try {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      // safety: listen() bound a TCP port, so address() returns AddressInfo.
      const { port } = server.address() as AddressInfo;
      await execFileAsync(
        "node",
        [
          "--import",
          "tsx",
          "--input-type=module",
          "--eval",
          `
            await import("./instrumentation.ts");
            const { trace } = await import("@opentelemetry/api");
            trace.getTracer("compatibility-test")
              .startSpan("otel-sentry-regression").end();
          `,
        ],
        {
          cwd: new URL("../../examples/opentelemetry/", import.meta.url),
          env: {
            ...process.env,
            SENTRY_DSN: `http://public@127.0.0.1:${port}/1`,
            OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `http://127.0.0.1:${port}/v1/traces`,
            OTEL_EXPORTER_OTLP_TRACES_COMPRESSION: "none",
            OTEL_LOGS_EXPORTER: "none",
            OTEL_METRICS_EXPORTER: "none",
            OTEL_NODE_RESOURCE_DETECTORS: "none",
          },
          timeout: 15_000,
        },
      );
      expect(destinations).toEqual(
        new Set(["/v1/traces", "/api/1/integration/otlp/v1/traces/"]),
      );
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  }, 20_000);
});
