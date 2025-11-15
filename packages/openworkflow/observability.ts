import { OpenWorkflow } from "./index.js";
import { serve as serveNode } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function serve(options: ObservabilityOptions) {
  const port = options.port ?? 3000;
  const app = new Hono();

  const dashboardPath = path.dirname(
    fileURLToPath(
      import.meta.resolve("@openworkflow/dashboard", import.meta.url),
    ),
  );

  // API endpoints are a slim HTTP wrapper around the OpenWorkflow client
  app.get("/api/test", (c) => {
    return c.json({
      message: "Fetched from openworkflow observability server",
    });
  });

  // Serve the dashboard SPA
  app.get("/", serveStatic({ root: path.resolve(dashboardPath, "dist") }));

  serveNode({ fetch: app.fetch, port });

  console.info(
    `OpenWorkflow dashboard running on http://localhost:${port.toString()}/`,
  );
}

export interface ObservabilityOptions {
  ow: OpenWorkflow;
  port?: number;
}
