import {
  discoverWorkflowFiles,
  getConfigTemplate,
  getPackagesToInstall,
  importWorkflows,
  init,
  workerStart,
} from "./commands.js";
import { CLIError } from "./errors.js";
import {
  POSTGRES_CONFIG,
  POSTGRES_PROD_SQLITE_DEV_CONFIG,
  SQLITE_CONFIG,
} from "./templates.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

describe("init", () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ow-init-test-"));
    originalCwd = process.cwd();
    process.chdir(tmpDir);

    // mock process.exit to prevent test from actually exiting
    vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  test("throws CLIError if config already exists", async () => {
    // create an existing config file
    fs.writeFileSync(
      path.join(tmpDir, "openworkflow.config.js"),
      "export default {}",
    );

    await expect(init()).rejects.toThrow(CLIError);
    await expect(init()).rejects.toThrow(/Config already exists/);
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
      `export default { backend: {} }`,
    );

    await expect(workerStart({})).rejects.toThrow(CLIError);
    await expect(workerStart({})).rejects.toThrow(/No workflows found/);
  });

  test("throws CLIError if workflow files have no workflow exports", async () => {
    // create config with custom dirs
    fs.writeFileSync(
      path.join(tmpDir, "openworkflow.config.js"),
      `export default { backend: {}, dirs: "./workflows" }`,
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
      `export default { backend: {}, dirs: "./single-dir" }`,
    );

    // test should throw because no workflow files in the dir
    await expect(workerStart({})).rejects.toThrow(CLIError);
    await expect(workerStart({})).rejects.toThrow(/No workflows found/);
  });

  test("uses default dirs when not specified in config", async () => {
    // create config without dirs - should default to "./openworkflow"
    fs.writeFileSync(
      path.join(tmpDir, "openworkflow.config.js"),
      `export default { backend: {} }`,
    );

    // create the default openworkflow dir (empty)
    fs.mkdirSync(path.join(tmpDir, "openworkflow"));

    // test should throw because no workflow files in default dir
    await expect(workerStart({})).rejects.toThrow(CLIError);
    await expect(workerStart({})).rejects.toThrow(/No workflows found/);
  });

  test("handles dirs as array in config", async () => {
    // creat config with dirs as array
    fs.writeFileSync(
      path.join(tmpDir, "openworkflow.config.js"),
      `export default { backend: {}, dirs: ["./workflows", "./more-workflows"] }`,
    );

    // create both directories (empty)
    fs.mkdirSync(path.join(tmpDir, "workflows"));
    fs.mkdirSync(path.join(tmpDir, "more-workflows"));

    // test should throw because no workflow files
    await expect(workerStart({})).rejects.toThrow(CLIError);
    await expect(workerStart({})).rejects.toThrow(/No workflows found/);
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
        `export default { backend: {}, dirs: ["${examplesDir.replaceAll("\\", "\\\\")}"] }`,
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
        `export default { backend: {}, dirs: ["${examplesDir.replaceAll("\\", "\\\\")}"] }`,
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
      `export default { backend: {}, dirs: "./workflows" }`,
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
      `export default { backend: {}, dirs: "./workflows" }`,
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
