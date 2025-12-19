import {
  createRun,
  describeRun,
  discoverWorkflowFiles,
  doctor,
  ensureEnvEntry,
  ensureGitignoreEntry,
  getConfigTemplate,
  getPackagesToInstall,
  importWorkflows,
  init,
  listRuns,
  workerStart,
} from "./commands.js";
import { CLIError } from "./errors.js";
import {
  POSTGRES_CONFIG,
  POSTGRES_PROD_SQLITE_DEV_CONFIG,
  SQLITE_CONFIG,
} from "./templates.js";
import { consola } from "consola";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

describe("doctor", () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ow-doctor-test-"));
    originalCwd = process.cwd();
    process.chdir(tmpDir);

    // spy on consola methods
    vi.spyOn(consola, "start");
    vi.spyOn(consola, "success");
    vi.spyOn(consola, "info");
    vi.spyOn(consola, "warn");
    vi.spyOn(consola, "log");
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  test("throws CLIError if no config file found", async () => {
    await expect(doctor()).rejects.toThrow(CLIError);
    await expect(doctor()).rejects.toThrow(/No config file found/);
  });

  test("throws CLIError if no workflow files found", async () => {
    // create a minimal config file
    fs.writeFileSync(
      path.join(tmpDir, "openworkflow.config.js"),
      `export default { backend: ${MOCK_BACKEND} }`,
    );

    await expect(doctor()).rejects.toThrow(CLIError);
    await expect(doctor()).rejects.toThrow(/No workflow files found/);
  });

  test("throws CLIError if workflow files have no workflow exports", async () => {
    // create config with custom dirs
    fs.writeFileSync(
      path.join(tmpDir, "openworkflow.config.js"),
      `export default { backend: ${MOCK_BACKEND}, dirs: "./workflows" }`,
    );

    // create workflows directory with a file that has no workflow exports
    const workflowsDir = path.join(tmpDir, "workflows");
    fs.mkdirSync(workflowsDir);
    fs.writeFileSync(
      path.join(workflowsDir, "not-a-workflow.ts"),
      `export const notAWorkflow = "string";`,
    );

    await expect(doctor()).rejects.toThrow(CLIError);
    await expect(doctor()).rejects.toThrow(/No workflows found/);
  });

  test("successfully discovers and lists workflows", async () => {
    // use the real example directory
    const examplesDir = path.join(
      import.meta.dirname,
      "../../examples/workflow-discovery/openworkflow",
    );

    // create config pointing to the real example directory
    fs.writeFileSync(
      path.join(tmpDir, "openworkflow.config.js"),
      `export default { backend: ${MOCK_BACKEND}, dirs: ["${examplesDir.replaceAll("\\", "\\\\")}"] }`,
    );

    await doctor();

    // verify consola was called with expected messages
    expect(consola.start).toHaveBeenCalledWith(
      "Running OpenWorkflow doctor...",
    );
    expect(consola.info).toHaveBeenCalledWith(
      expect.stringContaining("Config file:"),
    );
    expect(consola.log).toHaveBeenCalledWith(
      expect.stringContaining("Workflow directories:"),
    );
    expect(consola.info).toHaveBeenCalledWith(
      expect.stringMatching(/Found \d+ workflow file\(s\):/),
    );
    expect(consola.info).toHaveBeenCalledWith(
      expect.stringMatching(/Discovered \d+ workflow\(s\):/),
    );
    expect(consola.success).toHaveBeenCalledWith("Configuration looks good!");
  });

  test("lists individual workflow files", async () => {
    // use the real example directory
    const examplesDir = path.join(
      import.meta.dirname,
      "../../examples/workflow-discovery/openworkflow",
    );

    // create config pointing to the real example directory
    fs.writeFileSync(
      path.join(tmpDir, "openworkflow.config.js"),
      `export default { backend: ${MOCK_BACKEND}, dirs: ["${examplesDir.replaceAll("\\", "\\\\")}"] }`,
    );

    await doctor();

    // verify consola.log was called with file paths
    expect(consola.log).toHaveBeenCalledWith(
      expect.stringContaining("greeting.ts"),
    );
  });

  test("lists individual workflows with names", async () => {
    // use the real example directory
    const examplesDir = path.join(
      import.meta.dirname,
      "../../examples/workflow-discovery/openworkflow",
    );

    // create config pointing to the real example directory
    fs.writeFileSync(
      path.join(tmpDir, "openworkflow.config.js"),
      `export default { backend: ${MOCK_BACKEND}, dirs: ["${examplesDir.replaceAll("\\", "\\\\")}"] }`,
    );

    await doctor();

    // verify consola.log was called with workflow names
    expect(consola.log).toHaveBeenCalledWith(
      expect.stringContaining("greeting"),
    );
  });

  test("displays workflow versions when present", async () => {
    // use the real example directory
    const examplesDir = path.join(
      import.meta.dirname,
      "../../examples/workflow-discovery/openworkflow",
    );

    // create config pointing to the real example directory
    fs.writeFileSync(
      path.join(tmpDir, "openworkflow.config.js"),
      `export default { backend: ${MOCK_BACKEND}, dirs: ["${examplesDir.replaceAll("\\", "\\\\")}"] }`,
    );

    await doctor();

    // greeting-default.ts has version 1.0.0
    expect(consola.log).toHaveBeenCalledWith(
      expect.stringContaining("greeting-default (version: 1.0.0)"),
    );
  });

  test("warns about duplicate workflows", async () => {
    // use the real example directory
    const examplesDir = path.join(
      import.meta.dirname,
      "../../examples/workflow-discovery/openworkflow",
    );

    // create a duplicate of greeting.ts
    const greetingContent = fs.readFileSync(
      path.join(examplesDir, "greeting.ts"),
      "utf8",
    );
    const duplicatePath = path.join(examplesDir, "greeting-duplicate-test.ts");
    fs.writeFileSync(duplicatePath, greetingContent);

    try {
      // create config pointing to the real example directory
      fs.writeFileSync(
        path.join(tmpDir, "openworkflow.config.js"),
        `export default { backend: ${MOCK_BACKEND}, dirs: ["${examplesDir.replaceAll("\\", "\\\\")}"] }`,
      );

      await doctor();

      // verify warning was issued
      expect(consola.warn).toHaveBeenCalledWith(
        expect.stringContaining("Duplicate workflow detected"),
      );
      expect(consola.warn).toHaveBeenCalledWith(
        expect.stringContaining("greeting"),
      );
    } finally {
      // clean up the duplicate file
      if (fs.existsSync(duplicatePath)) {
        fs.unlinkSync(duplicatePath);
      }
    }
  });

  test("uses default directory when dirs not specified in config", async () => {
    // create config without dirs
    fs.writeFileSync(
      path.join(tmpDir, "openworkflow.config.js"),
      `export default { backend: ${MOCK_BACKEND} }`,
    );

    // create the default openworkflow dir (empty)
    fs.mkdirSync(path.join(tmpDir, "openworkflow"));

    await expect(doctor()).rejects.toThrow(CLIError);
    // should mention the default directory
    expect(consola.log).toHaveBeenCalledWith(
      expect.stringContaining("./openworkflow"),
    );
  });

  test("handles dirs as string instead of array", async () => {
    // create config with dirs as a string (not array)
    fs.writeFileSync(
      path.join(tmpDir, "openworkflow.config.js"),
      `export default { backend: ${MOCK_BACKEND}, dirs: "./single-dir" }`,
    );

    // create the directory (empty)
    fs.mkdirSync(path.join(tmpDir, "single-dir"));

    await expect(doctor()).rejects.toThrow(CLIError);
    // should handle the string correctly
    expect(consola.log).toHaveBeenCalledWith(
      expect.stringContaining("./single-dir"),
    );
  });

  test("handles dirs as array in config", async () => {
    // create config with dirs as array
    fs.writeFileSync(
      path.join(tmpDir, "openworkflow.config.js"),
      `export default { backend: ${MOCK_BACKEND}, dirs: ["./dir1", "./dir2"] }`,
    );

    // create both directories (empty)
    fs.mkdirSync(path.join(tmpDir, "dir1"));
    fs.mkdirSync(path.join(tmpDir, "dir2"));

    await expect(doctor()).rejects.toThrow(CLIError);
    // should handle the array correctly
    expect(consola.log).toHaveBeenCalledWith(
      expect.stringContaining("./dir1, ./dir2"),
    );
  });
});

describe("discoverWorkflowFiles", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ow-cli-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("returns empty array for empty directory", () => {
    const files = discoverWorkflowFiles([tmpDir], tmpDir);
    expect(files).toEqual([]);
  });

  test("returns empty array for non-existent directory", () => {
    const files = discoverWorkflowFiles(
      [path.join(tmpDir, "nonexistent")],
      tmpDir,
    );
    expect(files).toEqual([]);
  });

  test("discovers .ts files", () => {
    const tsFile = path.join(tmpDir, "workflow.ts");
    fs.writeFileSync(tsFile, "export const x = 1;");

    const files = discoverWorkflowFiles([tmpDir], tmpDir);
    expect(files).toContain(tsFile);
  });

  test("discovers .js files", () => {
    const jsFile = path.join(tmpDir, "workflow.js");
    fs.writeFileSync(jsFile, "export const x = 1;");

    const files = discoverWorkflowFiles([tmpDir], tmpDir);
    expect(files).toContain(jsFile);
  });

  test("discovers .mjs files", () => {
    const mjsFile = path.join(tmpDir, "workflow.mjs");
    fs.writeFileSync(mjsFile, "export const x = 1;");

    const files = discoverWorkflowFiles([tmpDir], tmpDir);
    expect(files).toContain(mjsFile);
  });

  test("discovers .cjs files", () => {
    const cjsFile = path.join(tmpDir, "workflow.cjs");
    fs.writeFileSync(cjsFile, "module.exports = { x: 1 };");

    const files = discoverWorkflowFiles([tmpDir], tmpDir);
    expect(files).toContain(cjsFile);
  });

  test("excludes .d.ts files", () => {
    const dtsFile = path.join(tmpDir, "workflow.d.ts");
    fs.writeFileSync(dtsFile, "export declare const x: number;");

    const files = discoverWorkflowFiles([tmpDir], tmpDir);
    expect(files).not.toContain(dtsFile);
  });

  test("excludes non-ts/js files", () => {
    const txtFile = path.join(tmpDir, "readme.txt");
    const jsonFile = path.join(tmpDir, "config.json");
    fs.writeFileSync(txtFile, "readme");
    fs.writeFileSync(jsonFile, "{}");

    const files = discoverWorkflowFiles([tmpDir], tmpDir);
    expect(files).not.toContain(txtFile);
    expect(files).not.toContain(jsonFile);
  });

  test("recursively scans subdirectories", () => {
    const subDir = path.join(tmpDir, "subdir");
    fs.mkdirSync(subDir);
    const nestedFile = path.join(subDir, "nested.ts");
    fs.writeFileSync(nestedFile, "export const x = 1;");

    const files = discoverWorkflowFiles([tmpDir], tmpDir);
    expect(files).toContain(nestedFile);
  });

  test("handles relative paths", () => {
    const relativeDir = "relative-dir";
    const absoluteDir = path.join(tmpDir, relativeDir);
    fs.mkdirSync(absoluteDir);
    const tsFile = path.join(absoluteDir, "workflow.ts");
    fs.writeFileSync(tsFile, "export const x = 1;");

    const files = discoverWorkflowFiles([relativeDir], tmpDir);
    expect(files).toContain(tsFile);
  });

  test("handles absolute paths", () => {
    const tsFile = path.join(tmpDir, "workflow.ts");
    fs.writeFileSync(tsFile, "export const x = 1;");

    const files = discoverWorkflowFiles([tmpDir], "/some/other/base");
    expect(files).toContain(tsFile);
  });

  test("scans multiple directories", () => {
    const dir1 = path.join(tmpDir, "dir1");
    const dir2 = path.join(tmpDir, "dir2");
    fs.mkdirSync(dir1);
    fs.mkdirSync(dir2);

    const file1 = path.join(dir1, "workflow1.ts");
    const file2 = path.join(dir2, "workflow2.ts");
    fs.writeFileSync(file1, "export const x = 1;");
    fs.writeFileSync(file2, "export const y = 2;");

    const files = discoverWorkflowFiles([dir1, dir2], tmpDir);
    expect(files).toContain(file1);
    expect(files).toContain(file2);
  });

  test("handles deeply nested directories", () => {
    const deep = path.join(tmpDir, "a", "b", "c", "d");
    fs.mkdirSync(deep, { recursive: true });
    const deepFile = path.join(deep, "workflow.ts");
    fs.writeFileSync(deepFile, "export const x = 1;");

    const files = discoverWorkflowFiles([tmpDir], tmpDir);
    expect(files).toContain(deepFile);
  });
});

describe("importWorkflows", () => {
  let tmpDir: string;

  // path to real workflow files for testing imports
  const examplesDir = path.resolve(
    import.meta.dirname,
    "../../examples/workflow-discovery/openworkflow",
  );

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ow-cli-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("returns empty array for empty file list", async () => {
    const workflows = await importWorkflows([]);
    expect(workflows).toEqual([]);
  });

  test("throws CLIError when file cannot be imported", async () => {
    const badFile = path.join(tmpDir, "bad.ts");
    fs.writeFileSync(badFile, "this is not valid javascript {{{");

    await expect(importWorkflows([badFile])).rejects.toThrow(CLIError);
  });

  test("throws CLIError with file path in message", async () => {
    const badFile = path.join(tmpDir, "bad.ts");
    fs.writeFileSync(badFile, "this is not valid javascript {{{");

    await expect(importWorkflows([badFile])).rejects.toThrow(
      /Failed to import workflow file/,
    );
  });

  test("returns empty array for file without workflow exports", async () => {
    const file = path.join(tmpDir, "no-workflow.ts");
    fs.writeFileSync(file, "export const notAWorkflow = 42;");

    const workflows = await importWorkflows([file]);
    expect(workflows).toEqual([]);
  });

  test("imports named workflow exports from real files", async () => {
    // greeting.ts exports a named workflow (greetingWorkflow)
    const greetingFile = path.join(examplesDir, "greeting.ts");

    const workflows = await importWorkflows([greetingFile]);
    expect(workflows.length).toBeGreaterThanOrEqual(1);

    const greetingWorkflow = workflows.find((w) => w.spec.name === "greeting");
    expect(greetingWorkflow).toBeDefined();
  });

  test("imports default workflow exports from real files", async () => {
    // greeting-default.ts exports a default workflow
    const defaultFile = path.join(examplesDir, "greeting-default.ts");

    const workflows = await importWorkflows([defaultFile]);
    expect(workflows.length).toBeGreaterThanOrEqual(1);

    const defaultWorkflow = workflows.find(
      (w) => w.spec.name === "greeting-default",
    );
    expect(defaultWorkflow).toBeDefined();
  });

  test("imports multiple workflows from same file", async () => {
    // math.ts exports multiple workflows (add-numbers, multiply-numbers)
    const mathFile = path.join(examplesDir, "math.ts");

    const workflows = await importWorkflows([mathFile]);
    expect(workflows.length).toBeGreaterThanOrEqual(2);

    const names = workflows.map((w) => w.spec.name);
    expect(names).toContain("add-numbers");
    expect(names).toContain("multiply-numbers");
  });

  test("imports workflows from multiple files", async () => {
    const greetingFile = path.join(examplesDir, "greeting.ts");
    const mathFile = path.join(examplesDir, "math.ts");

    const workflows = await importWorkflows([greetingFile, mathFile]);
    expect(workflows.length).toBeGreaterThanOrEqual(3);

    const names = workflows.map((w) => w.spec.name);
    expect(names).toContain("greeting");
    expect(names).toContain("add-numbers");
    expect(names).toContain("multiply-numbers");
  });

  test("ignores non-workflow exports", async () => {
    // create a file with both workflow and non-workflow exports
    const file = path.join(tmpDir, "mixed.js");
    fs.writeFileSync(
      file,
      `
      export const notAWorkflow = "just a string";
      export const aNumber = 42;
      export const anObject = { key: "value" };
    `,
    );

    const workflows = await importWorkflows([file]);
    expect(workflows).toHaveLength(0);
  });
});

describe("getConfigTemplate", () => {
  test("returns SQLITE_CONFIG for sqlite choice", () => {
    expect(getConfigTemplate("sqlite")).toBe(SQLITE_CONFIG);
  });

  test("returns POSTGRES_CONFIG for postgres choice", () => {
    expect(getConfigTemplate("postgres")).toBe(POSTGRES_CONFIG);
  });

  test("returns POSTGRES_PROD_SQLITE_DEV_CONFIG for both choice", () => {
    expect(getConfigTemplate("both")).toBe(POSTGRES_PROD_SQLITE_DEV_CONFIG);
  });
});

describe("getPackagesToInstall", () => {
  test("returns openworkflow and backend-sqlite for sqlite choice", () => {
    const packages = getPackagesToInstall("sqlite");
    expect(packages).toHaveLength(2);
    expect(packages).toContain("openworkflow");
    expect(packages).toContain("@openworkflow/backend-sqlite");
    expect(packages).not.toContain("@openworkflow/backend-postgres");
  });

  test("returns openworkflow and backend-postgres for postgres choice", () => {
    const packages = getPackagesToInstall("postgres");
    expect(packages).toHaveLength(2);
    expect(packages).toContain("openworkflow");
    expect(packages).toContain("@openworkflow/backend-postgres");
    expect(packages).not.toContain("@openworkflow/backend-sqlite");
  });

  test("returns openworkflow and both backends for both choice", () => {
    const packages = getPackagesToInstall("both");
    expect(packages).toHaveLength(3);
    expect(packages).toContain("openworkflow");
    expect(packages).toContain("@openworkflow/backend-sqlite");
    expect(packages).toContain("@openworkflow/backend-postgres");
  });
});

describe("createRun", () => {
  let tmpDir: string;
  let originalCwd: string;

  // path to real workflow files for testing
  const examplesDir = path.resolve(
    import.meta.dirname,
    "../../examples/workflow-discovery/openworkflow",
  );

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ow-run-test-"));
    originalCwd = process.cwd();
    process.chdir(tmpDir);

    // mock process.exit to prevent test from exiting
    vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  test("throws CLIError if no config file found", async () => {
    await expect(createRun(undefined, {})).rejects.toThrow(CLIError);
    await expect(createRun(undefined, {})).rejects.toThrow(
      /No config file found/,
    );
  });

  test("throws CLIError if both --input and --file are specified", async () => {
    // create config with workflow directory
    fs.writeFileSync(
      path.join(tmpDir, "openworkflow.config.js"),
      `export default { backend: ${MOCK_BACKEND}, dirs: ["${examplesDir.replaceAll("\\", "\\\\")}"] }`,
    );

    await expect(
      createRun("greeting", { input: '{"name":"test"}', file: "input.json" }),
    ).rejects.toThrow(CLIError);
    await expect(
      createRun("greeting", { input: '{"name":"test"}', file: "input.json" }),
    ).rejects.toThrow(/Cannot specify both --input and --file/);
  });

  test("throws CLIError if --input is invalid JSON", async () => {
    // create config with workflow directory
    fs.writeFileSync(
      path.join(tmpDir, "openworkflow.config.js"),
      `export default { backend: ${MOCK_BACKEND}, dirs: ["${examplesDir.replaceAll("\\", "\\\\")}"] }`,
    );

    await expect(
      createRun("greeting", { input: "not valid json" }),
    ).rejects.toThrow(CLIError);
    await expect(
      createRun("greeting", { input: "not valid json" }),
    ).rejects.toThrow(/Invalid JSON in --input/);
  });

  test("throws CLIError if --file does not exist", async () => {
    // create config with workflow directory
    fs.writeFileSync(
      path.join(tmpDir, "openworkflow.config.js"),
      `export default { backend: ${MOCK_BACKEND}, dirs: ["${examplesDir.replaceAll("\\", "\\\\")}"] }`,
    );

    await expect(
      createRun("greeting", { file: "nonexistent.json" }),
    ).rejects.toThrow(CLIError);
    await expect(
      createRun("greeting", { file: "nonexistent.json" }),
    ).rejects.toThrow(/File not found/);
  });

  test("throws CLIError if --file contains invalid JSON", async () => {
    // create config with workflow directory
    fs.writeFileSync(
      path.join(tmpDir, "openworkflow.config.js"),
      `export default { backend: ${MOCK_BACKEND}, dirs: ["${examplesDir.replaceAll("\\", "\\\\")}"] }`,
    );

    // create invalid JSON file
    const inputFile = path.join(tmpDir, "input.json");
    fs.writeFileSync(inputFile, "not valid json");

    await expect(createRun("greeting", { file: inputFile })).rejects.toThrow(
      CLIError,
    );
    await expect(createRun("greeting", { file: inputFile })).rejects.toThrow(
      /Failed to parse JSON from file/,
    );
  });

  test("throws CLIError if no workflow files found", async () => {
    // create config pointing to empty directory
    const emptyDir = path.join(tmpDir, "empty");
    fs.mkdirSync(emptyDir);
    fs.writeFileSync(
      path.join(tmpDir, "openworkflow.config.js"),
      `export default { backend: ${MOCK_BACKEND}, dirs: ["./empty"] }`,
    );

    await expect(createRun(undefined, {})).rejects.toThrow(CLIError);
    await expect(createRun(undefined, {})).rejects.toThrow(
      /No workflow files found/,
    );
  });

  test("throws CLIError when duplicate workflow names found", async () => {
    // use the real example directory
    const examplesDir = path.join(
      import.meta.dirname,
      "../../examples/workflow-discovery/openworkflow",
    );

    // create a duplicate of greeting.ts in the examples directory temporarily
    const greetingContent = fs.readFileSync(
      path.join(examplesDir, "greeting.ts"),
      "utf8",
    );
    const duplicatePath = path.join(examplesDir, "greeting-duplicate-test.ts");
    fs.writeFileSync(duplicatePath, greetingContent);

    try {
      // create config pointing to the real example directory
      fs.writeFileSync(
        path.join(tmpDir, "openworkflow.config.js"),
        `export default { backend: ${MOCK_BACKEND}, dirs: ["${examplesDir.replaceAll("\\", "\\\\")}"] }`,
      );

      await expect(createRun("greeting", {})).rejects.toThrow(CLIError);
      await expect(createRun("greeting", {})).rejects.toThrow(
        /Duplicate workflow name/,
      );
      await expect(createRun("greeting", {})).rejects.toThrow(/greeting/);
    } finally {
      // clean up the duplicate file
      if (fs.existsSync(duplicatePath)) {
        fs.unlinkSync(duplicatePath);
      }
    }
  });

  test("throws CLIError if workflow not found by name", async () => {
    // create config with workflow directory
    fs.writeFileSync(
      path.join(tmpDir, "openworkflow.config.js"),
      `export default { backend: ${MOCK_BACKEND}, dirs: ["${examplesDir.replaceAll("\\", "\\\\")}"] }`,
    );

    await expect(createRun("nonexistent-workflow", {})).rejects.toThrow(
      CLIError,
    );
    await expect(createRun("nonexistent-workflow", {})).rejects.toThrow(
      /Workflow not found: "nonexistent-workflow"/,
    );
  });
});

describe("workerStart", () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ow-worker-test-"));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  test("throws CLIError if no config file found", async () => {
    await expect(workerStart({})).rejects.toThrow(CLIError);
    await expect(workerStart({})).rejects.toThrow(/No config file found/);
  });

  test("throws CLIError if no workflow files found", async () => {
    // create a minimal config file
    fs.writeFileSync(
      path.join(tmpDir, "openworkflow.config.js"),
      `export default { backend: ${MOCK_BACKEND} }`,
    );

    await expect(workerStart({})).rejects.toThrow(CLIError);
    await expect(workerStart({})).rejects.toThrow(/No workflow files found/);
  });

  test("throws CLIError if workflow files have no workflow exports", async () => {
    // create config with custom dirs
    fs.writeFileSync(
      path.join(tmpDir, "openworkflow.config.js"),
      `export default { backend: ${MOCK_BACKEND}, dirs: "./workflows" }`,
    );

    // create workflows directory with a file that has no workflow exports
    const workflowsDir = path.join(tmpDir, "workflows");
    fs.mkdirSync(workflowsDir);
    fs.writeFileSync(
      path.join(workflowsDir, "not-a-workflow.ts"),
      `export const notAWorkflow = "string";`,
    );

    await expect(workerStart({})).rejects.toThrow(CLIError);
    await expect(workerStart({})).rejects.toThrow(/No workflows found/);
  });

  test("handles dirs as string instead of array", async () => {
    // create config with dirs as a string (not array)
    fs.writeFileSync(
      path.join(tmpDir, "openworkflow.config.js"),
      `export default { backend: ${MOCK_BACKEND}, dirs: "./single-dir" }`,
    );

    // test should throw because no workflow files in the dir
    await expect(workerStart({})).rejects.toThrow(CLIError);
    await expect(workerStart({})).rejects.toThrow(/No workflow files found/);
  });

  test("uses default dirs when not specified in config", async () => {
    // create config without dirs - should default to "./openworkflow"
    fs.writeFileSync(
      path.join(tmpDir, "openworkflow.config.js"),
      `export default { backend: ${MOCK_BACKEND} }`,
    );

    // create the default openworkflow dir (empty)
    fs.mkdirSync(path.join(tmpDir, "openworkflow"));

    // test should throw because no workflow files in default dir
    await expect(workerStart({})).rejects.toThrow(CLIError);
    await expect(workerStart({})).rejects.toThrow(/No workflow files found/);
  });

  test("handles dirs as array in config", async () => {
    // creat config with dirs as array
    fs.writeFileSync(
      path.join(tmpDir, "openworkflow.config.js"),
      `export default { backend: ${MOCK_BACKEND}, dirs: ["./workflows", "./more-workflows"] }`,
    );

    // create both directories (empty)
    fs.mkdirSync(path.join(tmpDir, "workflows"));
    fs.mkdirSync(path.join(tmpDir, "more-workflows"));

    // test should throw because no workflow files
    await expect(workerStart({})).rejects.toThrow(CLIError);
    await expect(workerStart({})).rejects.toThrow(/No workflow files found/);
  });

  test("throws CLIError for invalid concurrency", async () => {
    // use the real example directory
    const examplesDir = path.join(
      import.meta.dirname,
      "../../examples/workflow-discovery/openworkflow",
    );

    // create config pointing to the real example directory
    fs.writeFileSync(
      path.join(tmpDir, "openworkflow.config.js"),
      `export default { backend: ${MOCK_BACKEND}, dirs: ["${examplesDir.replaceAll("\\", "\\\\")}"] }`,
    );

    await expect(workerStart({ concurrency: Number.NaN })).rejects.toThrow(
      CLIError,
    );
    await expect(workerStart({ concurrency: Number.NaN })).rejects.toThrow(
      /Invalid concurrency/,
    );
  });

  test("throws CLIError when duplicate workflow names found (unversioned)", async () => {
    // use the real example directory
    const examplesDir = path.join(
      import.meta.dirname,
      "../../examples/workflow-discovery/openworkflow",
    );

    // create a duplicate of greeting.ts in the examples directory temporarily
    const greetingContent = fs.readFileSync(
      path.join(examplesDir, "greeting.ts"),
      "utf8",
    );
    const duplicatePath = path.join(examplesDir, "greeting-duplicate-test.ts");
    fs.writeFileSync(duplicatePath, greetingContent);

    try {
      // create config pointing to the real example directory
      fs.writeFileSync(
        path.join(tmpDir, "openworkflow.config.js"),
        `export default { backend: ${MOCK_BACKEND}, dirs: ["${examplesDir.replaceAll("\\", "\\\\")}"] }`,
      );

      await expect(workerStart({})).rejects.toThrow(CLIError);
      await expect(workerStart({})).rejects.toThrow(/Duplicate workflow name/);
      await expect(workerStart({})).rejects.toThrow(/greeting/);
    } finally {
      // clean up the duplicate file
      if (fs.existsSync(duplicatePath)) {
        fs.unlinkSync(duplicatePath);
      }
    }
  });

  test("throws CLIError when duplicate workflow names found (versioned)", async () => {
    // use the real example directory
    const examplesDir = path.join(
      import.meta.dirname,
      "../../examples/workflow-discovery/openworkflow",
    );

    // create a duplicate of greeting-default.ts in the examples directory
    // temporarily
    const greetingDefaultContent = fs.readFileSync(
      path.join(examplesDir, "greeting-default.ts"),
      "utf8",
    );
    const duplicatePath = path.join(
      examplesDir,
      "greeting-default-duplicate-test.ts",
    );
    fs.writeFileSync(duplicatePath, greetingDefaultContent);

    try {
      // create config pointing to the real example directory
      fs.writeFileSync(
        path.join(tmpDir, "openworkflow.config.js"),
        `export default { backend: ${MOCK_BACKEND}, dirs: ["${examplesDir.replaceAll("\\", "\\\\")}"] }`,
      );

      await expect(workerStart({})).rejects.toThrow(CLIError);
      await expect(workerStart({})).rejects.toThrow(/Duplicate workflow name/);
      await expect(workerStart({})).rejects.toThrow(/greeting-default/);
      await expect(workerStart({})).rejects.toThrow(/version: 1\.0\.0/);
    } finally {
      // clean up the duplicate file
      if (fs.existsSync(duplicatePath)) {
        fs.unlinkSync(duplicatePath);
      }
    }
  });

  test("allows same name with different versions", async () => {
    // create config
    fs.writeFileSync(
      path.join(tmpDir, "openworkflow.config.js"),
      `export default { backend: ${MOCK_BACKEND}, dirs: "./workflows" }`,
    );

    // create workflows directory
    const workflowsDir = path.join(tmpDir, "workflows");
    fs.mkdirSync(workflowsDir);

    // copy math.ts and set both workflows to same name but different versions
    const mathContent = fs.readFileSync(
      path.join(
        import.meta.dirname,
        "../../examples/workflow-discovery/openworkflow/math.ts",
      ),
      "utf8",
    );
    // change both workflow names to "my-workflow" with different versions
    const content = mathContent
      .replace(
        /name: "add-numbers", version: "1\.0\.0"/,
        'name: "my-workflow", version: "v1"',
      )
      .replace(
        /name: "multiply-numbers", version: "1\.0\.0"/,
        'name: "my-workflow", version: "v2"',
      );
    fs.writeFileSync(path.join(workflowsDir, "workflows.ts"), content);

    // this should not throw - different versions should be allowed we'll just
    // check that it doesn't throw a duplicate error it will still fail because
    // backend is undefined, but that's a different error
    await expect(workerStart({})).rejects.toThrow();
    // should not have thrown duplicate error
    await expect(workerStart({})).rejects.not.toThrow(
      /Duplicate workflow name/,
    );
  });

  test("allows same name when one is versioned and one is not", async () => {
    // create config
    fs.writeFileSync(
      path.join(tmpDir, "openworkflow.config.js"),
      `export default { backend: ${MOCK_BACKEND}, dirs: "./workflows" }`,
    );

    // create workflows directory
    const workflowsDir = path.join(tmpDir, "workflows");
    fs.mkdirSync(workflowsDir);

    // copy math.ts and set one workflow with version and one without
    const mathContent = fs.readFileSync(
      path.join(
        import.meta.dirname,
        "../../examples/workflow-discovery/openworkflow/math.ts",
      ),
      "utf8",
    );
    // change both to same name, but one with version and one without
    const content = mathContent
      .replace(
        /name: "add-numbers", version: "1\.0\.0"/,
        'name: "my-workflow", version: "v1"',
      )
      .replace(
        /name: "multiply-numbers", version: "1\.0\.0"/,
        'name: "my-workflow"',
      );
    fs.writeFileSync(path.join(workflowsDir, "workflows.ts"), content);

    // this should not throw - versioned and unversioned with same name should
    // be allowed
    await expect(workerStart({})).rejects.toThrow();
    // should not have thrown duplicate error
    await expect(workerStart({})).rejects.not.toThrow(
      /Duplicate workflow name/,
    );
  });
});

describe("listRuns", () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ow-list-test-"));
    originalCwd = process.cwd();
    process.chdir(tmpDir);

    // spy on consola methods
    vi.spyOn(consola, "info");
    vi.spyOn(consola, "log");
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  test("throws CLIError if no config file found", async () => {
    await expect(listRuns({})).rejects.toThrow(CLIError);
    await expect(listRuns({})).rejects.toThrow(/No config file found/);
  });

  test("displays message when no runs found", async () => {
    // create config with mock backend that returns empty results
    fs.writeFileSync(
      path.join(tmpDir, "openworkflow.config.js"),
      `export default { backend: {
        stop: async () => {},
        listWorkflowRuns: async () => ({ data: [], pagination: { next: null, prev: null } })
      }}`,
    );

    await listRuns({});

    expect(consola.info).toHaveBeenCalledWith("No workflow runs found.");
  });

  test("lists runs in table format", async () => {
    const mockRuns = [
      {
        id: "run-123",
        workflowName: "test-workflow",
        version: null,
        status: "completed",
        createdAt: new Date("2024-01-01T12:00:00Z"),
      },
      {
        id: "run-456",
        workflowName: "another-workflow",
        version: "1.0.0",
        status: "running",
        createdAt: new Date("2024-01-02T12:00:00Z"),
      },
    ];

    fs.writeFileSync(
      path.join(tmpDir, "openworkflow.config.js"),
      `export default { backend: {
        stop: async () => {},
        listWorkflowRuns: async () => ({
          data: ${JSON.stringify(mockRuns).replaceAll('"', "'").replaceAll("'", '"')},
          pagination: { next: null, prev: null }
        })
      }}`,
    );

    await listRuns({});

    expect(consola.info).toHaveBeenCalledWith(
      expect.stringContaining("Showing 2 workflow run(s)"),
    );
    expect(consola.log).toHaveBeenCalledWith(
      expect.stringContaining("run-123"),
    );
    expect(consola.log).toHaveBeenCalledWith(
      expect.stringContaining("run-456"),
    );
  });

  test("displays pagination info when available", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "openworkflow.config.js"),
      `export default { backend: {
        stop: async () => {},
        listWorkflowRuns: async () => ({
          data: [{ id: "run-1", workflowName: "test", version: null, status: "pending", createdAt: new Date() }],
          pagination: { next: "cursor-next", prev: null }
        })
      }}`,
    );

    await listRuns({});

    expect(consola.info).toHaveBeenCalledWith(
      expect.stringContaining("Next page: ow runs list --after cursor-next"),
    );
  });

  test("passes limit option to backend", async () => {
    // Create a config that captures the params passed to listWorkflowRuns
    fs.writeFileSync(
      path.join(tmpDir, "openworkflow.config.js"),
      `export default { backend: {
        stop: async () => {},
        listWorkflowRuns: async (params) => {
          // The test verifies the function is called - if limit isn't passed correctly
          // the function would fail. We return empty data to complete the test.
          if (params.limit !== 5) {
            throw new Error('Expected limit to be 5, got ' + params.limit);
          }
          return { data: [], pagination: { next: null, prev: null } };
        }
      }}`,
    );

    // If the limit is not passed correctly, this will throw
    await listRuns({ limit: 5 });

    expect(consola.info).toHaveBeenCalledWith("No workflow runs found.");
  });

  test("throws CLIError for invalid limit", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "openworkflow.config.js"),
      `export default { backend: { stop: async () => {}, listWorkflowRuns: async () => ({ data: [], pagination: { next: null, prev: null } }) } }`,
    );

    await expect(listRuns({ limit: Number.NaN })).rejects.toThrow(CLIError);
    await expect(listRuns({ limit: Number.NaN })).rejects.toThrow(
      /Invalid limit/,
    );
  });
});

describe("describeRun", () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ow-describe-test-"));
    originalCwd = process.cwd();
    process.chdir(tmpDir);

    // spy on consola methods
    vi.spyOn(consola, "box");
    vi.spyOn(consola, "log");
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  test("throws CLIError if no config file found", async () => {
    await expect(describeRun("run-123")).rejects.toThrow(CLIError);
    await expect(describeRun("run-123")).rejects.toThrow(
      /No config file found/,
    );
  });

  test("throws CLIError if run not found", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "openworkflow.config.js"),
      `export default { backend: {
        stop: async () => {},
        getWorkflowRun: async () => null
      }}`,
    );

    await expect(describeRun("nonexistent-run")).rejects.toThrow(CLIError);
    await expect(describeRun("nonexistent-run")).rejects.toThrow(
      /Workflow run not found: nonexistent-run/,
    );
  });

  test("displays run details in a box", async () => {
    const mockRun = {
      id: "run-123",
      workflowName: "test-workflow",
      version: "1.0.0",
      status: "completed",
      input: { name: "test" },
      output: { result: "success" },
      error: null,
      workerId: "worker-1",
      createdAt: new Date("2024-01-01T12:00:00Z"),
      startedAt: new Date("2024-01-01T12:00:01Z"),
      finishedAt: new Date("2024-01-01T12:00:05Z"),
    };

    fs.writeFileSync(
      path.join(tmpDir, "openworkflow.config.js"),
      `export default { backend: {
        stop: async () => {},
        getWorkflowRun: async () => (${JSON.stringify(mockRun).replaceAll(/"(\d{4}-\d{2}-\d{2}T[\d:.]+Z)"/g, 'new Date("$1")')}),
        listStepAttempts: async () => ({ data: [], pagination: { next: null, prev: null } })
      }}`,
    );

    await describeRun("run-123");

    expect(consola.box).toHaveBeenCalledWith(
      expect.stringContaining("Run ID: run-123"),
    );
    expect(consola.box).toHaveBeenCalledWith(
      expect.stringContaining("test-workflow@1.0.0"),
    );
    expect(consola.box).toHaveBeenCalledWith(
      expect.stringContaining("completed"),
    );
  });

  test("displays input and output", async () => {
    const mockRun = {
      id: "run-123",
      workflowName: "test-workflow",
      version: null,
      status: "completed",
      input: { name: "test-input" },
      output: { result: "test-output" },
      error: null,
      workerId: null,
      createdAt: new Date("2024-01-01T12:00:00Z"),
      startedAt: null,
      finishedAt: null,
    };

    fs.writeFileSync(
      path.join(tmpDir, "openworkflow.config.js"),
      `export default { backend: {
        stop: async () => {},
        getWorkflowRun: async () => (${JSON.stringify(mockRun).replaceAll(/"(\d{4}-\d{2}-\d{2}T[\d:.]+Z)"/g, 'new Date("$1")')}),
        listStepAttempts: async () => ({ data: [], pagination: { next: null, prev: null } })
      }}`,
    );

    await describeRun("run-123");

    // Check that input section is displayed
    expect(consola.log).toHaveBeenCalledWith("\n📥 Input:");
    expect(consola.log).toHaveBeenCalledWith(
      expect.stringContaining("test-input"),
    );

    // Check that output section is displayed
    expect(consola.log).toHaveBeenCalledWith("\n📤 Output:");
    expect(consola.log).toHaveBeenCalledWith(
      expect.stringContaining("test-output"),
    );
  });

  test("displays error when run has failed", async () => {
    const mockRun = {
      id: "run-123",
      workflowName: "test-workflow",
      version: null,
      status: "failed",
      input: null,
      output: null,
      error: { message: "Something went wrong", name: "Error" },
      workerId: null,
      createdAt: new Date("2024-01-01T12:00:00Z"),
      startedAt: null,
      finishedAt: null,
    };

    fs.writeFileSync(
      path.join(tmpDir, "openworkflow.config.js"),
      `export default { backend: {
        stop: async () => {},
        getWorkflowRun: async () => (${JSON.stringify(mockRun).replaceAll(/"(\d{4}-\d{2}-\d{2}T[\d:.]+Z)"/g, 'new Date("$1")')}),
        listStepAttempts: async () => ({ data: [], pagination: { next: null, prev: null } })
      }}`,
    );

    await describeRun("run-123");

    expect(consola.log).toHaveBeenCalledWith("\n❌ Error:");
    expect(consola.log).toHaveBeenCalledWith(
      expect.stringContaining("Something went wrong"),
    );
  });

  test("displays steps timeline when steps exist", async () => {
    const mockRun = {
      id: "run-123",
      workflowName: "test-workflow",
      version: null,
      status: "completed",
      input: null,
      output: null,
      error: null,
      workerId: null,
      createdAt: new Date("2024-01-01T12:00:00Z"),
      startedAt: null,
      finishedAt: null,
    };

    fs.writeFileSync(
      path.join(tmpDir, "openworkflow.config.js"),
      `export default { backend: {
        stop: async () => {},
        getWorkflowRun: async () => (${JSON.stringify(mockRun).replaceAll(/"(\d{4}-\d{2}-\d{2}T[\d:.]+Z)"/g, 'new Date("$1")')}),
        listStepAttempts: async () => ({
          data: [
            { id: "step-1", stepName: "fetch-data", kind: "task", status: "completed", createdAt: new Date("2024-01-01T12:00:00Z"), startedAt: new Date("2024-01-01T12:00:01Z"), finishedAt: new Date("2024-01-01T12:00:02Z") },
            { id: "step-2", stepName: "process-data", kind: "task", status: "completed", createdAt: new Date("2024-01-01T12:00:02Z"), startedAt: new Date("2024-01-01T12:00:02Z"), finishedAt: new Date("2024-01-01T12:00:03Z") }
          ],
          pagination: { next: null, prev: null }
        })
      }}`,
    );

    await describeRun("run-123");

    expect(consola.log).toHaveBeenCalledWith("\n📋 Steps Timeline:");
    expect(consola.log).toHaveBeenCalledWith(
      expect.stringContaining("fetch-data"),
    );
    expect(consola.log).toHaveBeenCalledWith(
      expect.stringContaining("process-data"),
    );
  });

  test("paginates step attempts", async () => {
    const mockRun = {
      id: "run-123",
      workflowName: "test-workflow",
      version: null,
      status: "completed",
      input: null,
      output: null,
      error: null,
      workerId: null,
      createdAt: new Date("2024-01-01T12:00:00Z"),
      startedAt: null,
      finishedAt: null,
    };

    fs.writeFileSync(
      path.join(tmpDir, "openworkflow.config.js"),
      `let callCount = 0;
      export default { backend: {
        stop: async () => {},
        getWorkflowRun: async () => (${JSON.stringify(mockRun).replaceAll(/"(\d{4}-\d{2}-\d{2}T[\d:.]+Z)"/g, 'new Date("$1")')}),
        listStepAttempts: async () => {
          callCount += 1;
          if (callCount === 1) {
            return {
              data: [
                { id: "step-1", stepName: "page-one", kind: "task", status: "completed", createdAt: new Date("2024-01-01T12:00:00Z"), startedAt: new Date("2024-01-01T12:00:01Z"), finishedAt: new Date("2024-01-01T12:00:02Z") }
              ],
              pagination: { next: "cursor-1", prev: null }
            };
          }
          return {
            data: [
              { id: "step-2", stepName: "page-two", kind: "task", status: "completed", createdAt: new Date("2024-01-01T12:00:02Z"), startedAt: new Date("2024-01-01T12:00:03Z"), finishedAt: new Date("2024-01-01T12:00:04Z") }
            ],
            pagination: { next: null, prev: "cursor-1" }
          };
        }
      }}`,
    );

    await describeRun("run-123");

    expect(consola.log).toHaveBeenCalledWith("\n📋 Steps Timeline:");
    expect(consola.log).toHaveBeenCalledWith(
      expect.stringContaining("page-two"),
    );
  });
});

describe("ensureGitignoreEntry", () => {
  let tmpDir: string;
  let gitignorePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ow-gitignore-test-"));
    gitignorePath = path.join(tmpDir, ".gitignore");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("creates .gitignore file with entry when file does not exist", () => {
    expect(fs.existsSync(gitignorePath)).toBe(false);

    const result = ensureGitignoreEntry(gitignorePath, ".openworkflow");

    expect(result).toEqual({ added: true, created: true });
    expect(fs.existsSync(gitignorePath)).toBe(true);
    expect(fs.readFileSync(gitignorePath, "utf8")).toBe(".openworkflow\n");
  });

  test("appends entry to existing .gitignore with trailing newline", () => {
    fs.writeFileSync(gitignorePath, "node_modules\n.env\n", "utf8");

    const result = ensureGitignoreEntry(gitignorePath, ".openworkflow");

    expect(result).toEqual({ added: true, created: false });
    expect(fs.readFileSync(gitignorePath, "utf8")).toBe(
      "node_modules\n.env\n.openworkflow\n",
    );
  });

  test("appends entry to existing .gitignore without trailing newline", () => {
    fs.writeFileSync(gitignorePath, "node_modules\n.env", "utf8");

    const result = ensureGitignoreEntry(gitignorePath, ".openworkflow");

    expect(result).toEqual({ added: true, created: false });
    expect(fs.readFileSync(gitignorePath, "utf8")).toBe(
      "node_modules\n.env\n.openworkflow\n",
    );
  });

  test("does not add duplicate entry when already present", () => {
    fs.writeFileSync(
      gitignorePath,
      "node_modules\n.openworkflow\n.env\n",
      "utf8",
    );

    const result = ensureGitignoreEntry(gitignorePath, ".openworkflow");

    expect(result).toEqual({ added: false, created: false });
    expect(fs.readFileSync(gitignorePath, "utf8")).toBe(
      "node_modules\n.openworkflow\n.env\n",
    );
  });

  test("detects entry with surrounding whitespace", () => {
    fs.writeFileSync(
      gitignorePath,
      "node_modules\n  .openworkflow  \n",
      "utf8",
    );

    const result = ensureGitignoreEntry(gitignorePath, ".openworkflow");

    expect(result).toEqual({ added: false, created: false });
  });

  test("handles empty file", () => {
    fs.writeFileSync(gitignorePath, "", "utf8");

    const result = ensureGitignoreEntry(gitignorePath, ".openworkflow");

    expect(result).toEqual({ added: true, created: false });
    expect(fs.readFileSync(gitignorePath, "utf8")).toBe(".openworkflow\n");
  });

  test("works with different entry names", () => {
    const result = ensureGitignoreEntry(gitignorePath, "dist");

    expect(result).toEqual({ added: true, created: true });
    expect(fs.readFileSync(gitignorePath, "utf8")).toBe("dist\n");
  });
});

describe("ensureEnvEntry", () => {
  let tmpDir: string;
  let envPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ow-env-test-"));
    envPath = path.join(tmpDir, ".env");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("creates .env file with entry when file does not exist", () => {
    expect(fs.existsSync(envPath)).toBe(false);

    const result = ensureEnvEntry(
      envPath,
      "OPENWORKFLOW_POSTGRES_URL",
      "postgresql://localhost:5432/db",
    );

    expect(result).toEqual({ added: true, created: true });
    expect(fs.existsSync(envPath)).toBe(true);
    expect(fs.readFileSync(envPath, "utf8")).toBe(
      "OPENWORKFLOW_POSTGRES_URL=postgresql://localhost:5432/db\n",
    );
  });

  test("appends entry to existing .env with trailing newline", () => {
    fs.writeFileSync(envPath, "NODE_ENV=development\nPORT=3000\n", "utf8");

    const result = ensureEnvEntry(
      envPath,
      "OPENWORKFLOW_POSTGRES_URL",
      "postgresql://localhost:5432/db",
    );

    expect(result).toEqual({ added: true, created: false });
    expect(fs.readFileSync(envPath, "utf8")).toBe(
      "NODE_ENV=development\nPORT=3000\nOPENWORKFLOW_POSTGRES_URL=postgresql://localhost:5432/db\n",
    );
  });

  test("appends entry to existing .env without trailing newline", () => {
    fs.writeFileSync(envPath, "NODE_ENV=development\nPORT=3000", "utf8");

    const result = ensureEnvEntry(
      envPath,
      "OPENWORKFLOW_POSTGRES_URL",
      "postgresql://localhost:5432/db",
    );

    expect(result).toEqual({ added: true, created: false });
    expect(fs.readFileSync(envPath, "utf8")).toBe(
      "NODE_ENV=development\nPORT=3000\nOPENWORKFLOW_POSTGRES_URL=postgresql://localhost:5432/db\n",
    );
  });

  test("does not add duplicate entry when already present", () => {
    fs.writeFileSync(
      envPath,
      "NODE_ENV=development\nOPENWORKFLOW_POSTGRES_URL=postgresql://localhost:5432/existing\nPORT=3000\n",
      "utf8",
    );

    const result = ensureEnvEntry(
      envPath,
      "OPENWORKFLOW_POSTGRES_URL",
      "postgresql://localhost:5432/db",
    );

    expect(result).toEqual({ added: false, created: false });
    expect(fs.readFileSync(envPath, "utf8")).toBe(
      "NODE_ENV=development\nOPENWORKFLOW_POSTGRES_URL=postgresql://localhost:5432/existing\nPORT=3000\n",
    );
  });

  test("detects entry with spaces around equals sign", () => {
    fs.writeFileSync(
      envPath,
      "OPENWORKFLOW_POSTGRES_URL = postgresql://localhost:5432/db\n",
      "utf8",
    );

    const result = ensureEnvEntry(
      envPath,
      "OPENWORKFLOW_POSTGRES_URL",
      "postgresql://localhost:5432/new",
    );

    expect(result).toEqual({ added: false, created: false });
  });

  test("handles empty file", () => {
    fs.writeFileSync(envPath, "", "utf8");

    const result = ensureEnvEntry(
      envPath,
      "OPENWORKFLOW_POSTGRES_URL",
      "postgresql://localhost:5432/db",
    );

    expect(result).toEqual({ added: true, created: false });
    expect(fs.readFileSync(envPath, "utf8")).toBe(
      "OPENWORKFLOW_POSTGRES_URL=postgresql://localhost:5432/db\n",
    );
  });

  test("works with different environment variables", () => {
    const result = ensureEnvEntry(envPath, "DATABASE_URL", "postgres://db");

    expect(result).toEqual({ added: true, created: true });
    expect(fs.readFileSync(envPath, "utf8")).toBe(
      "DATABASE_URL=postgres://db\n",
    );
  });

  test("does not match similar variable names", () => {
    fs.writeFileSync(
      envPath,
      "OPENWORKFLOW_POSTGRES_URL_BACKUP=postgresql://backup\n",
      "utf8",
    );

    const result = ensureEnvEntry(
      envPath,
      "OPENWORKFLOW_POSTGRES_URL",
      "postgresql://localhost:5432/db",
    );

    expect(result).toEqual({ added: true, created: false });
    expect(fs.readFileSync(envPath, "utf8")).toBe(
      "OPENWORKFLOW_POSTGRES_URL_BACKUP=postgresql://backup\nOPENWORKFLOW_POSTGRES_URL=postgresql://localhost:5432/db\n",
    );
  });
});

// ugly mock backend that implements the minimal Backend interface
// used in config files to avoid "backend.stop is not a function" errors
// will come back for a longer term fix later
const MOCK_BACKEND = `{
  stop: async () => {},
}`;
