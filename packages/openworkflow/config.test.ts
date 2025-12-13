import { BackendPostgres } from "../backend-postgres/backend.js";
import { DEFAULT_DATABASE_URL } from "../backend-postgres/postgres.js";
import { defineConfig } from "./config.js";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";

describe("defineConfig", async () => {
  const backend = await BackendPostgres.connect(DEFAULT_DATABASE_URL, {
    namespaceId: randomUUID(),
  });

  test("returns the same config", () => {
    const config = { backend };
    const result = defineConfig(config);
    expect(result).toBe(config);
  });
});
