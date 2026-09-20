This example uses OpenTelemetry to trace a workflow's HTTP request, sleep, and
retry.

You can see the traces in Aspire (via the local Docker Compose) or Sentry.

1. Run `npm install` from the repo root (not the example root)
2. Build OpenWorkflow: `npm run build --workspace=openworkflow`
3. (Optional) Start Aspire: `docker compose up -d aspire`
4. (Optional) Set your Sentry DSN: `export SENTRY_DSN='<your-dsn>'`
5. Start the server and worker: `npm start --workspace=example-opentelemetry`
6. In another terminal, run `curl -X POST http://127.0.0.1:3000/workflows`
7. Find the returned `workflowRunId` in [Aspire](http://localhost:18888/traces) and Sentry
8. Stop with Ctrl+C
