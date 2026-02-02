import { BackendPostgres } from "./backend.js";
import { DEFAULT_POSTGRES_URL } from "./postgres.js";
import assert from "node:assert";
import { randomUUID } from "node:crypto";
import { testBackend } from "openworkflow/internal";
import { test } from "vitest";

test("it is a test file (workaround for sonarjs/no-empty-test-file linter)", () => {
  assert.ok(true);
});

testBackend({
  setup: async () => {
    return await BackendPostgres.connect(DEFAULT_POSTGRES_URL, {
      namespaceId: randomUUID(),
    });
  },
  teardown: async (backend) => {
    await backend.stop();
  },
});
