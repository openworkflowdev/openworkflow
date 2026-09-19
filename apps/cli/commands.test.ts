import {
  discoverWorkflowFiles,
  getDashboardSpawnOptions,
  getClientFileName,
  getConfigFileName,
  getExampleWorkflowFileName,
  getRunFileName,
  validateDashboardPort,
  init as initializeProject,
} from "./commands.js";
import { loadConfigFromPath } from "./config.js";
import type * as p from "@clack/prompts";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { addDependency } from "nypm";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

describe("getConfigFileName", () => {
  test("prefers TypeScript when it is in devDependencies", () => {
    expect(
      getConfigFileName({ devDependencies: { typescript: "^5.0.0" } }),
    ).toBe("openworkflow.config.ts");
  });

  test("prefers TypeScript when it is in dependencies", () => {
    expect(getConfigFileName({ dependencies: { typescript: "^5.0.0" } })).toBe(
      "openworkflow.config.ts",
    );
  });

  test("falls back to JavaScript when TypeScript is missing", () => {
    expect(getConfigFileName(null)).toBe("openworkflow.config.js");
  });

  test("falls back to JavaScript when package.json has no TypeScript", () => {
    expect(getConfigFileName({ dependencies: {}, devDependencies: {} })).toBe(
      "openworkflow.config.js",
    );
  });
});

describe("getExampleWorkflowFileName", () => {
  test("uses TypeScript when it is in devDependencies", () => {
    expect(
      getExampleWorkflowFileName({
        devDependencies: { typescript: "^5.0.0" },
      }),
    ).toBe("hello-world.ts");
  });

  test("uses TypeScript when it is in dependencies", () => {
    expect(
      getExampleWorkflowFileName({
        dependencies: { typescript: "^5.0.0" },
      }),
    ).toBe("hello-world.ts");
  });

  test("falls back to JavaScript when package.json is missing", () => {
    expect(getExampleWorkflowFileName(null)).toBe("hello-world.js");
  });

  test("falls back to JavaScript when package.json has no TypeScript", () => {
    expect(
      getExampleWorkflowFileName({ dependencies: {}, devDependencies: {} }),
    ).toBe("hello-world.js");
  });
});

describe("getRunFileName", () => {
  test("uses TypeScript when it is in devDependencies", () => {
    expect(
      getRunFileName({
        devDependencies: { typescript: "^5.0.0" },
      }),
    ).toBe("hello-world.run.ts");
  });

  test("uses TypeScript when it is in dependencies", () => {
    expect(
      getRunFileName({
        dependencies: { typescript: "^5.0.0" },
      }),
    ).toBe("hello-world.run.ts");
  });

  test("falls back to JavaScript when package.json is missing", () => {
    expect(getRunFileName(null)).toBe("hello-world.run.js");
  });

  test("falls back to JavaScript when package.json has no TypeScript", () => {
    expect(getRunFileName({ dependencies: {}, devDependencies: {} })).toBe(
      "hello-world.run.js",
    );
  });
});

describe("getClientFileName", () => {
  test("uses TypeScript when it is in devDependencies", () => {
    expect(
      getClientFileName({
        devDependencies: { typescript: "^5.0.0" },
      }),
    ).toBe("client.ts");
  });

  test("uses TypeScript when it is in dependencies", () => {
    expect(
      getClientFileName({
        dependencies: { typescript: "^5.0.0" },
      }),
    ).toBe("client.ts");
  });

  test("falls back to JavaScript when package.json is missing", () => {
    expect(getClientFileName(null)).toBe("client.js");
  });

  test("falls back to JavaScript when package.json has no TypeScript", () => {
    expect(getClientFileName({ dependencies: {}, devDependencies: {} })).toBe(
      "client.js",
    );
  });
});

describe("discoverWorkflowFiles", () => {
  test("respects ignorePatterns", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ow-ignore-"));
    try {
      const workflowsDir = path.join(tmpDir, "openworkflow");
      fs.mkdirSync(workflowsDir, { recursive: true });

      const keepFile = path.join(workflowsDir, "hello-world.ts");
      const ignoredFile = path.join(workflowsDir, "hello-world.skip.ts");

      fs.writeFileSync(keepFile, "export const hello = true;");
      fs.writeFileSync(ignoredFile, "export const skip = true;");

      const files = discoverWorkflowFiles(["openworkflow"], tmpDir, [
        "**/*.skip.ts",
      ]);

      expect(files).toEqual([keepFile]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("getDashboardSpawnOptions", () => {
  test("uses default npx command without a custom port env", () => {
    const options = getDashboardSpawnOptions();

    expect(options.command).toBe("npx");
    expect(options.args).toEqual(["@openworkflow/dashboard"]);
    expect(options.spawnOptions.env?.["PORT"]).toBeUndefined();
    expect(options.spawnOptions.stdio).toBe("inherit");
  });

  test("sets PORT env when a custom dashboard port is provided", () => {
    const options = getDashboardSpawnOptions(4321);

    expect(options.command).toBe("npx");
    expect(options.args).toEqual(["@openworkflow/dashboard"]);
    expect(options.spawnOptions.env?.["PORT"]).toBe("4321");
    expect(options.spawnOptions.stdio).toBe("inherit");
  });
});

describe("validateDashboardPort", () => {
  test("returns undefined when no custom port is provided", () => {
    expect(validateDashboardPort()).toBeUndefined();
  });

  test("returns the port when it is within range", () => {
    expect(validateDashboardPort(3001)).toBe(3001);
  });

  test("throws for non-integer ports", () => {
    expect(() => validateDashboardPort(Number.NaN)).toThrow(
      "Invalid dashboard port.",
    );
    expect(() => validateDashboardPort(3000.5)).toThrow(
      "Invalid dashboard port.",
    );
  });

  test("throws for out-of-range ports", () => {
    expect(() => validateDashboardPort(0)).toThrow("Invalid dashboard port.");
    expect(() => validateDashboardPort(65_536)).toThrow(
      "Invalid dashboard port.",
    );
  });
});

describe("init", () => {
  const dependencies = {
    addDependency: vi.fn<typeof addDependency>(),
    note: vi.fn<typeof p.note>(),
  };

  function init(
    options: Parameters<typeof initializeProject>[0],
  ): Promise<void> {
    return initializeProject(options, dependencies);
  }

  let cwd: string;
  const isTTY = process.stdin.isTTY;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ow-init-"));
    fs.writeFileSync(path.join(cwd, "package.json"), '{"type":"module"}');
    vi.spyOn(process, "cwd").mockReturnValue(cwd);
    dependencies.addDependency.mockReset().mockResolvedValue({});
    process.stdin.isTTY = false;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.stdin.isTTY = isTTY;
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  test.each(["sqlite", "postgres", "both"] as const)(
    "scaffolds %s without prompts or installation",
    async (backend) => {
      await init({ backend, yes: true, skipInstall: true });
      const client = fs.readFileSync(
        path.join(cwd, "openworkflow/client.js"),
        "utf8",
      );
      expect(client.includes("BackendSqlite.connect")).toBe(
        backend !== "postgres",
      );
      expect(client.includes("BackendPostgres.connect")).toBe(
        backend !== "sqlite",
      );
      expect(fs.existsSync(path.join(cwd, "openworkflow.config.js"))).toBe(
        true,
      );
      expect(dependencies.addDependency).not.toHaveBeenCalled();
      expect(
        JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf8")),
      ).toEqual({
        type: "module",
        scripts: { worker: "npx @openworkflow/cli worker start" },
      });
    },
  );

  test("requires a backend with --yes", async () => {
    await expect(init({ yes: true })).rejects.toThrow("--backend is required");
  });

  test.each([
    "my config.js",
    "config/custom.js",
    'my "quoted" $HOME `printf expanded` $(printf expanded) config\'s.js',
  ])(
    "includes the literal config path in generated commands: %s",
    async (config) => {
      const note = dependencies.note.mockClear();
      await init({ backend: "sqlite", yes: true, skipInstall: true, config });
      const manifest = JSON.parse(
        fs.readFileSync(path.join(cwd, "package.json"), "utf8"),
      ) as { scripts: { worker: string } };
      const nextSteps = note.mock.calls.find(
        ([, title]) => title === "Next steps",
      )?.[0];
      const commands = nextSteps
        ?.split("\n")
        .filter((line) => line.startsWith("$ npx @openworkflow/cli"))
        .map((line) => line.slice(2));
      expect(commands).toHaveLength(2);

      for (const [command, subcommand] of [
        [manifest.scripts.worker, ["worker", "start"]],
        [commands?.[0], ["worker", "start"]],
        [commands?.[1], ["dashboard"]],
      ] as const) {
        // Let the shell parse the command, but capture arguments instead of running npx.
        const args = execFileSync(
          "sh",
          ["-c", `npx() { printf '%s\\n' "$@"; }; ${command}`],
          { cwd, encoding: "utf8" },
        )
          .trimEnd()
          .split("\n");
        expect(args).toEqual([
          "@openworkflow/cli",
          ...subcommand,
          "--config",
          config,
        ]);
      }
    },
  );

  test.each([
    ["openworkflow.config.js", false],
    ["config/custom.js", false],
    ["config/nested/custom.ts", false],
    ["openworkflow/custom.js", false],
    ["config/custom.js", true],
  ])(
    "resolves scaffold paths from %s (absolute: %s)",
    async (file, absolute) => {
      const configPath = absolute ? path.join(cwd, file) : file;
      await init({
        backend: "sqlite",
        yes: true,
        skipInstall: true,
        config: configPath,
      });

      const clientPath = path.join(cwd, "openworkflow/client.js");
      expect(fs.existsSync(clientPath)).toBe(true);
      // Exercise the generated import without opening a database.
      fs.writeFileSync(clientPath, 'export const backend = { name: "test" };');
      fs.symlinkSync(
        path.resolve(import.meta.dirname, "../../node_modules"),
        path.join(cwd, "node_modules"),
        "dir",
      );

      const { config, configFile } = await loadConfigFromPath(configPath, cwd);
      expect(config.backend).toEqual({ name: "test" });
      expect(configFile).toBe(path.join(cwd, file));
      const files = discoverWorkflowFiles(
        [config.dirs as string],
        path.dirname(path.resolve(cwd, configPath)),
        config.ignorePatterns,
      );
      expect(files).toContain(path.join(cwd, "openworkflow/hello-world.js"));
      expect(files).not.toContain(
        path.join(cwd, "openworkflow/hello-world.run.js"),
      );
    },
  );

  test("requires --yes without a terminal", async () => {
    await expect(init({ backend: "sqlite" })).rejects.toThrow(
      "requires a terminal",
    );
  });

  test.each([
    ["openworkflow.config.js", 'throw new Error("config executed");'],
    ["package.json", '{"scripts":{"worker":"custom"}}'],
  ])("preserves existing %s", async (file, contents) => {
    fs.writeFileSync(path.join(cwd, file), contents);
    await expect(init({ backend: "sqlite", yes: true })).rejects.toThrow(
      "overwrite",
    );
    expect(dependencies.addDependency).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(cwd, file), "utf8")).toBe(contents);
  });

  test.each([
    "[]",
    '{"scripts":"invalid"}',
    '{"dependencies":[]}',
    '{"devDependencies":{"typescript":true}}',
  ])("rejects invalid manifest %s", async (contents) => {
    fs.writeFileSync(path.join(cwd, "package.json"), contents);
    await expect(
      init({ backend: "sqlite", yes: true, skipInstall: true }),
    ).rejects.toThrow("Invalid package.json");
    expect(fs.existsSync(path.join(cwd, "openworkflow"))).toBe(false);
    expect(fs.readFileSync(path.join(cwd, "package.json"), "utf8")).toBe(
      contents,
    );
  });

  test("installs runtime and development dependencies", async () => {
    await init({ backend: "postgres", yes: true });
    expect(dependencies.addDependency).toHaveBeenCalledWith(
      ["openworkflow", "postgres"],
      {
        silent: true,
        packageManager: "npm",
      },
    );
    expect(dependencies.addDependency).toHaveBeenCalledWith(
      ["@openworkflow/cli"],
      {
        silent: true,
        dev: true,
        packageManager: "npm",
      },
    );
  });
});
