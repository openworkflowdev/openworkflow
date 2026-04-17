import type { Backend } from "../openworkflow/core/backend.js";
// Same realm as BackendHttp so `instanceof BackendError` checks are valid
// under vitest (the `openworkflow/internal` re-export is a different realm).
import { BackendError } from "../openworkflow/core/error.js";
import { BackendHttp } from "../openworkflow/http/backend.js";
import { BackendPostgres } from "../openworkflow/postgres/backend.js";
import { DEFAULT_POSTGRES_URL } from "../openworkflow/postgres/postgres.js";
import { testBackend } from "../openworkflow/testing/backend.testsuite.js";
import { createServer } from "./server.js";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a BackendHttp backed by an in-process Hono server over a real
 * Postgres backend. Requests never leave the process — Hono's `app.fetch()`
 * handles them directly via the Web Standard fetch interface.
 * @returns BackendHttp and the underlying BackendPostgres for teardown
 */
async function createHttpBackend(): Promise<{
  backend: BackendHttp;
  pgBackend: BackendPostgres;
}> {
  const pgBackend = await BackendPostgres.connect(DEFAULT_POSTGRES_URL, {
    namespaceId: randomUUID(),
  });
  // The shared test suite asserts on Postgres error messages, which are
  // plain Error instances (not BackendError). Opt into message passthrough
  // so those assertions can be checked across the HTTP boundary.
  const server = createServer(pgBackend, { exposeInternalErrors: true });

  const backend = new BackendHttp({
    url: "http://localhost:0",
    fetch: async (input, init) => {
      const request = new Request(input, init);
      return server.fetch(request);
    },
  });

  return { backend, pgBackend };
}

const pgBackends = new WeakMap<Backend, BackendPostgres>();

// ---------------------------------------------------------------------------
// Full Backend test suite: BackendHttp → Server → BackendPostgres → Postgres
// ---------------------------------------------------------------------------

testBackend({
  setup: async () => {
    const { backend, pgBackend } = await createHttpBackend();
    pgBackends.set(backend, pgBackend);
    return backend;
  },
  teardown: async (backend) => {
    const pgBackend = pgBackends.get(backend);
    if (pgBackend) {
      await pgBackend.stop();
      pgBackends.delete(backend);
    }
    await backend.stop();
  },
});

// ---------------------------------------------------------------------------
// Server-specific tests (against a real Postgres backend)
// ---------------------------------------------------------------------------

describe("Server", () => {
  let pgBackend: BackendPostgres;
  let fetch: (request: Request) => Response | Promise<Response>;

  beforeEach(async () => {
    pgBackend = await BackendPostgres.connect(DEFAULT_POSTGRES_URL, {
      namespaceId: randomUUID(),
    });
    const server = createServer(pgBackend);
    fetch = (req) => server.fetch(req);
  });

  afterEach(async () => {
    await pgBackend.stop();
  });

  // -----------------------------------------------------------------------
  // Liveness & readiness
  // -----------------------------------------------------------------------

  test("GET /healthz returns 200 ok without hitting backend", async () => {
    const res = await fetch(new Request("http://localhost/healthz"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  test("GET /readyz returns 200 ok when backend is reachable", async () => {
    const res = await fetch(new Request("http://localhost/readyz"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  // -----------------------------------------------------------------------
  // Routing sanity
  // -----------------------------------------------------------------------

  test("GET /v0/workflow-runs:count is routed to counts, not to getWorkflowRun", async () => {
    const res = await fetch(
      new Request("http://localhost/v0/workflow-runs:count"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, number>;
    for (const key of [
      "pending",
      "running",
      "completed",
      "failed",
      "canceled",
    ]) {
      expect(body[key]).toBe(0);
    }
  });

  test("GET /v0/workflow-runs/:id returns 404 for non-existent run", async () => {
    const res = await fetch(
      new Request(`http://localhost/v0/workflow-runs/${randomUUID()}`),
    );
    expect(res.status).toBe(404);
  });

  test("POST /v0/workflow-runs:claim returns 204 when nothing available", async () => {
    const res = await fetch(
      new Request("http://localhost/v0/workflow-runs:claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workerId: randomUUID(), leaseDurationMs: 1000 }),
      }),
    );
    expect(res.status).toBe(204);
  });

  test("GET /v0/signal-deliveries/:id returns 204 when no delivery", async () => {
    const res = await fetch(
      new Request(`http://localhost/v0/signal-deliveries/${randomUUID()}`),
    );
    expect(res.status).toBe(204);
  });

  // -----------------------------------------------------------------------
  // Verb routing: 404 for unknown/missing verbs
  // -----------------------------------------------------------------------

  test("POST /v0/workflow-runs/:id with no verb returns 404", async () => {
    const res = await fetch(
      new Request(`http://localhost/v0/workflow-runs/${randomUUID()}`, {
        method: "POST",
      }),
    );
    expect(res.status).toBe(404);
  });

  test("POST /v0/workflow-runs/:id:unknownVerb returns 404", async () => {
    const res = await fetch(
      new Request(`http://localhost/v0/workflow-runs/${randomUUID()}:bogus`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(404);
  });

  test("POST /v0/step-attempts/:id with no verb returns 404", async () => {
    const res = await fetch(
      new Request(`http://localhost/v0/step-attempts/${randomUUID()}`, {
        method: "POST",
      }),
    );
    expect(res.status).toBe(404);
  });

  test("POST /v0/step-attempts/:id:unknownVerb returns 404", async () => {
    const res = await fetch(
      new Request(`http://localhost/v0/step-attempts/${randomUUID()}:bogus`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(404);
  });

  test("GET /v0/step-attempts/:id returns 404 for non-existent attempt", async () => {
    const res = await fetch(
      new Request(`http://localhost/v0/step-attempts/${randomUUID()}`),
    );
    expect(res.status).toBe(404);
  });

  // -----------------------------------------------------------------------
  // Backend-thrown errors propagate as 4xx/5xx
  // -----------------------------------------------------------------------

  test("POST /v0/workflow-runs/:id:cancel on non-existent run returns error", async () => {
    const res = await fetch(
      new Request(`http://localhost/v0/workflow-runs/${randomUUID()}:cancel`, {
        method: "POST",
      }),
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Request validation (no Postgres required — pure protocol behavior)
// ---------------------------------------------------------------------------

describe("Server request validation", () => {
  const server = createServer(mockBackend());
  function fetch(req: Request): Response | Promise<Response> {
    return server.fetch(req);
  }

  test("POST /v0/workflow-runs with invalid body returns 400", async () => {
    const res = await fetch(
      new Request("http://localhost/v0/workflow-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bad: "body" }),
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toBeDefined();
  });

  test("POST /v0/workflow-runs with non-JSON body returns 400 (not 500)", async () => {
    const res = await fetch(
      new Request("http://localhost/v0/workflow-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not-json",
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/json/i);
  });

  test("POST /v0/workflow-runs:claim with invalid body returns 400", async () => {
    const res = await fetch(
      new Request("http://localhost/v0/workflow-runs:claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(400);
  });

  test("POST /v0/workflow-runs/:id:extendLease with invalid body returns 400", async () => {
    const res = await fetch(
      new Request(
        `http://localhost/v0/workflow-runs/${randomUUID()}:extendLease`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bad: true }),
        },
      ),
    );
    expect(res.status).toBe(400);
  });

  test("POST /v0/workflow-runs rejects invalid availableAt date string", async () => {
    const res = await fetch(
      new Request("http://localhost/v0/workflow-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workflowName: "test",
          version: null,
          idempotencyKey: null,
          config: {},
          context: null,
          input: null,
          availableAt: "not-a-date",
        }),
      }),
    );
    expect(res.status).toBe(400);
  });

  test("POST /v0/workflow-runs/:id:sleep rejects invalid availableAt", async () => {
    const res = await fetch(
      new Request(`http://localhost/v0/workflow-runs/${randomUUID()}:sleep`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workerId: randomUUID(),
          availableAt: "garbage",
        }),
      }),
    );
    expect(res.status).toBe(400);
  });

  test("GET /v0/workflow-runs rejects non-numeric limit with 400", async () => {
    const res = await fetch(
      new Request("http://localhost/v0/workflow-runs?limit=abc"),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/limit/i);
  });

  test("GET /v0/workflow-runs rejects zero limit with 400", async () => {
    const res = await fetch(
      new Request("http://localhost/v0/workflow-runs?limit=0"),
    );
    expect(res.status).toBe(400);
  });

  test("GET /v0/workflow-runs rejects fractional limit with 400", async () => {
    const res = await fetch(
      new Request("http://localhost/v0/workflow-runs?limit=1.5"),
    );
    expect(res.status).toBe(400);
  });

  test("GET /v0/workflow-runs rejects both after and before with 400", async () => {
    const res = await fetch(
      new Request("http://localhost/v0/workflow-runs?after=a&before=b"),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/mutually exclusive/i);
  });

  test("rejects payloads over the body size limit with 413", async () => {
    const server = createServer(mockBackend(), { maxBodyBytes: 1024 });
    const res = await server.fetch(
      new Request("http://localhost/v0/workflow-runs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": String(2048),
        },
        // payload doesn't need to be real - content-length is enough to trigger
        body: "x".repeat(2048),
      }),
    );
    expect(res.status).toBe(413);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    const body = (await res.json()) as { error: { message: string } };
    expect(typeof body.error.message).toBe("string");
    expect(body.error.message.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Error handling — mock backend to exercise error paths
// ---------------------------------------------------------------------------

function notImplemented(): never {
  throw new Error("not implemented");
}

function mockBackend(overrides: Partial<Backend> = {}): Backend {
  return {
    createWorkflowRun: vi.fn(notImplemented),
    getWorkflowRun: vi.fn(notImplemented),
    listWorkflowRuns: vi.fn(notImplemented),
    countWorkflowRuns: vi.fn(notImplemented),
    claimWorkflowRun: vi.fn(notImplemented),
    extendWorkflowRunLease: vi.fn(notImplemented),
    sleepWorkflowRun: vi.fn(notImplemented),
    completeWorkflowRun: vi.fn(notImplemented),
    failWorkflowRun: vi.fn(notImplemented),
    rescheduleWorkflowRunAfterFailedStepAttempt: vi.fn(notImplemented),
    cancelWorkflowRun: vi.fn(notImplemented),
    createStepAttempt: vi.fn(notImplemented),
    getStepAttempt: vi.fn(notImplemented),
    listStepAttempts: vi.fn(notImplemented),
    completeStepAttempt: vi.fn(notImplemented),
    failStepAttempt: vi.fn(notImplemented),
    setStepAttemptChildWorkflowRun: vi.fn(notImplemented),
    sendSignal: vi.fn(notImplemented),
    getSignalDelivery: vi.fn(notImplemented),
    stop: vi.fn(),
    ...overrides,
  } as unknown as Backend;
}

describe("Server error handling", () => {
  test("maps BackendError NOT_FOUND to 404 with code", async () => {
    const backend = mockBackend({
      getWorkflowRun: vi
        .fn()
        .mockRejectedValue(new BackendError("NOT_FOUND", "run not found")),
    });
    const server = createServer(backend);
    const res = await server.fetch(
      new Request(`http://localhost/v0/workflow-runs/${randomUUID()}`),
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as {
      error: { message: string; code?: string };
    };
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.message).toBe("run not found");
  });

  test("maps BackendError CONFLICT to 409 with code", async () => {
    const backend = mockBackend({
      createWorkflowRun: vi
        .fn()
        .mockRejectedValue(new BackendError("CONFLICT", "duplicate key")),
    });
    const server = createServer(backend);
    const res = await server.fetch(
      new Request("http://localhost/v0/workflow-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workflowName: "test",
          version: null,
          idempotencyKey: null,
          config: {},
          context: null,
          input: null,
        }),
      }),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      error: { message: string; code?: string };
    };
    expect(body.error.code).toBe("CONFLICT");
  });

  test("scrubs non-BackendError messages to a generic 500 and invokes onError", async () => {
    const onError = vi.fn();
    const backend = mockBackend({
      listWorkflowRuns: vi
        .fn()
        .mockRejectedValue(new Error("SELECT * FROM passwords")),
    });
    const server = createServer(backend, { onError });
    const res = await server.fetch(
      new Request("http://localhost/v0/workflow-runs"),
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toBe("Internal server error");
    expect(body.error.message).not.toContain("passwords");
    expect(onError).toHaveBeenCalledOnce();
    const [err] = onError.mock.calls[0] as [Error];
    expect(err.message).toBe("SELECT * FROM passwords");
  });

  test("BackendError does not invoke onError hook", async () => {
    const onError = vi.fn();
    const backend = mockBackend({
      getWorkflowRun: vi
        .fn()
        .mockRejectedValue(new BackendError("NOT_FOUND", "nope")),
    });
    const server = createServer(backend, { onError });
    await server.fetch(
      new Request(`http://localhost/v0/workflow-runs/${randomUUID()}`),
    );
    expect(onError).not.toHaveBeenCalled();
  });

  test("BackendError propagates through verb dispatch with correct status", async () => {
    const backend = mockBackend({
      extendWorkflowRunLease: vi
        .fn()
        .mockRejectedValue(new BackendError("NOT_FOUND", "not found")),
    });
    const server = createServer(backend);
    const res = await server.fetch(
      new Request(
        `http://localhost/v0/workflow-runs/${randomUUID()}:extendLease`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workerId: randomUUID(),
            leaseDurationMs: 5000,
          }),
        },
      ),
    );
    expect(res.status).toBe(404);
  });

  test("readyz returns 503 when backend cannot serve requests", async () => {
    const backend = mockBackend({
      countWorkflowRuns: vi.fn().mockRejectedValue(new Error("db down")),
    });
    const server = createServer(backend);
    const res = await server.fetch(new Request("http://localhost/readyz"));
    expect(res.status).toBe(503);
  });

  test("logRequests: true wires Hono's logger middleware", () => {
    expect(() =>
      createServer(mockBackend(), { logRequests: true }),
    ).not.toThrow();
  });

  test("fail verb round-trips deadlineAt and attempts end-to-end", async () => {
    const failWorkflowRun = vi.fn().mockResolvedValue({});
    const backend = mockBackend({ failWorkflowRun });
    const server = createServer(backend);
    const http = new BackendHttp({
      url: "http://localhost",
      fetch: (input, init) =>
        Promise.resolve(server.fetch(new Request(input, init))),
    });
    const deadline = new Date("2030-01-01T00:00:00.000Z");
    await http.failWorkflowRun({
      workflowRunId: randomUUID(),
      workerId: randomUUID(),
      error: { message: "boom" },
      retryPolicy: {
        initialInterval: "1s",
        backoffCoefficient: 2,
        maximumInterval: "1m",
        maximumAttempts: 3,
      },
      attempts: 2,
      deadlineAt: deadline,
    });
    expect(failWorkflowRun).toHaveBeenCalledOnce();
    const [params] = failWorkflowRun.mock.calls[0] as [
      { deadlineAt?: Date | null; attempts?: number },
    ];
    if (!(params.deadlineAt instanceof Date)) {
      throw new TypeError("expected deadlineAt to be a Date");
    }
    expect(params.deadlineAt.toISOString()).toBe(deadline.toISOString());
    expect(params.attempts).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// BackendHttp round-trip behavior
// ---------------------------------------------------------------------------

/**
 * Build a BackendHttp instance that uses the supplied fetch stub.
 * @param fetch - Fetch stub the backend should call
 * @returns BackendHttp wired to the stub
 */
function backendWithFetch(fetch: typeof globalThis.fetch): BackendHttp {
  return new BackendHttp({ url: "http://localhost:3000", fetch });
}

/**
 * Build a fetch stub that always returns the given response.
 * @param response - Response to return for every call
 * @returns A fetch-compatible function
 */
function fetchReturning(response: Response): typeof globalThis.fetch {
  // eslint-disable-next-line @typescript-eslint/require-await -- fetch is async
  return async () => response.clone();
}

describe("BackendHttp", () => {
  test("assembles URLs against a URL with trailing slash correctly", async () => {
    const calls: string[] = [];
    // eslint-disable-next-line @typescript-eslint/require-await -- fetch is async
    async function fakeFetch(input: string | URL | Request): Promise<Response> {
      let url: string;
      if (typeof input === "string") url = input;
      else if (input instanceof URL) url = input.href;
      else url = input.url;
      calls.push(url);
      return new Response(null, { status: 404 });
    }
    const backend = new BackendHttp({
      url: "http://localhost:3000/",
      fetch: fakeFetch,
    });
    await backend.getWorkflowRun({ workflowRunId: "abc" });
    expect(calls[0]).toBe("http://localhost:3000/v0/workflow-runs/abc");
  });

  test("stop() resolves without error", async () => {
    const backend = new BackendHttp({ url: "http://localhost:3000" });
    await expect(backend.stop()).resolves.toBeUndefined();
  });

  test("re-throws BackendError when server returns a code field", async () => {
    const backend = backendWithFetch(
      fetchReturning(
        Response.json(
          { error: { message: "run not found", code: "NOT_FOUND" } },
          { status: 404 },
        ),
      ),
    );
    await expect(
      backend.extendWorkflowRunLease({
        workflowRunId: randomUUID(),
        workerId: randomUUID(),
        leaseDurationMs: 1000,
      }),
    ).rejects.toMatchObject({
      name: "BackendError",
      code: "NOT_FOUND",
      message: "run not found",
    });
  });

  test("re-throws BackendError for CONFLICT", async () => {
    const backend = backendWithFetch(
      fetchReturning(
        Response.json(
          { error: { message: "duplicate", code: "CONFLICT" } },
          { status: 409 },
        ),
      ),
    );
    await expect(
      backend.createWorkflowRun({
        workflowName: "w",
        version: null,
        idempotencyKey: null,
        config: {},
        context: null,
        input: null,
        parentStepAttemptNamespaceId: null,
        parentStepAttemptId: null,
        availableAt: null,
        deadlineAt: null,
      }),
    ).rejects.toBeInstanceOf(BackendError);
  });

  test("throws plain Error when server response has no code", async () => {
    const backend = backendWithFetch(
      fetchReturning(
        Response.json({ error: { message: "boom" } }, { status: 500 }),
      ),
    );
    await expect(backend.countWorkflowRuns()).rejects.not.toBeInstanceOf(
      BackendError,
    );
  });

  test("throws plain Error when server returns unrecognized code", async () => {
    const backend = backendWithFetch(
      fetchReturning(
        Response.json(
          { error: { message: "weird", code: "UNKNOWN_CODE" } },
          { status: 418 },
        ),
      ),
    );
    await expect(backend.countWorkflowRuns()).rejects.not.toBeInstanceOf(
      BackendError,
    );
  });

  test("falls back to response text when body is not JSON", async () => {
    const backend = backendWithFetch(
      fetchReturning(new Response("plain text failure", { status: 500 })),
    );
    await expect(backend.countWorkflowRuns()).rejects.toThrow(
      /plain text failure/,
    );
  });
});
