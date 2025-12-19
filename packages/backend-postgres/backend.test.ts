import { BackendPostgres } from "./backend.js";
import { DEFAULT_DATABASE_URL } from "./postgres.js";
import { testBackend } from "@openworkflow/backend-test";
import assert from "node:assert";
import { randomUUID } from "node:crypto";
import { test } from "vitest";

test("it is a test file (workaround for sonarjs/no-empty-test-file linter)", () => {
  assert.ok(true);
});

testBackend({
  setup: async () => {
    return await BackendPostgres.connect(DEFAULT_DATABASE_URL, {
      namespaceId: randomUUID(),
    });
  },
  teardown: async (backend) => {
    await backend.stop();
  },
});
