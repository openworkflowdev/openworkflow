import { WorkflowRegistry } from "./registry.js";
import { defineWorkflow } from "./workflow.js";
import { describe, expect, test } from "vitest";

describe("WorkflowRegistry", () => {
  describe("register", () => {
    test("registers a workflow without version", () => {
      const registry = new WorkflowRegistry();
      const workflow = createMockWorkflow("my-workflow");

      registry.register(workflow);

      expect(registry.get("my-workflow", null)).toBe(workflow);
    });

    test("registers a workflow with version", () => {
      const registry = new WorkflowRegistry();
      const workflow = createMockWorkflow("my-workflow", "v1");

      registry.register(workflow);

      expect(registry.get("my-workflow", "v1")).toBe(workflow);
    });

    test("registers multiple versions of the same workflow", () => {
      const registry = new WorkflowRegistry();
      const v1 = createMockWorkflow("my-workflow", "v1");
      const v2 = createMockWorkflow("my-workflow", "v2");

      registry.register(v1);
      registry.register(v2);

      expect(registry.get("my-workflow", "v1")).toBe(v1);
      expect(registry.get("my-workflow", "v2")).toBe(v2);
    });

    test("registers different workflows with same version", () => {
      const registry = new WorkflowRegistry();
      const workflow1 = createMockWorkflow("workflow-a", "v1");
      const workflow2 = createMockWorkflow("workflow-b", "v1");

      registry.register(workflow1);
      registry.register(workflow2);

      expect(registry.get("workflow-a", "v1")).toBe(workflow1);
      expect(registry.get("workflow-b", "v1")).toBe(workflow2);
    });

    test("throws when registering duplicate unversioned workflow", () => {
      const registry = new WorkflowRegistry();
      registry.register(createMockWorkflow("my-workflow"));

      expect(() => {
        registry.register(createMockWorkflow("my-workflow"));
      }).toThrow('Workflow "my-workflow" is already registered');
    });

    test("throws when registering duplicate versioned workflow", () => {
      const registry = new WorkflowRegistry();
      registry.register(createMockWorkflow("my-workflow", "v1"));

      expect(() => {
        registry.register(createMockWorkflow("my-workflow", "v1"));
      }).toThrow('Workflow "my-workflow" (version: v1) is already registered');
    });

    test("allows same name with different versions", () => {
      const registry = new WorkflowRegistry();
      const versioned = createMockWorkflow("my-workflow", "v1");
      const unversioned = createMockWorkflow("my-workflow");

      registry.register(versioned);
      registry.register(unversioned);

      expect(registry.get("my-workflow", "v1")).toBe(versioned);
      expect(registry.get("my-workflow", null)).toBe(unversioned);
    });
  });

  describe("get", () => {
    test("returns undefined for non-existent workflow", () => {
      const registry = new WorkflowRegistry();

      expect(registry.get("non-existent", null)).toBeUndefined();
    });

    test("returns undefined for wrong version", () => {
      const registry = new WorkflowRegistry();
      registry.register(createMockWorkflow("my-workflow", "v1"));

      expect(registry.get("my-workflow", "v2")).toBeUndefined();
      expect(registry.get("my-workflow", null)).toBeUndefined();
    });

    test("returns undefined for versioned lookup on unversioned workflow", () => {
      const registry = new WorkflowRegistry();
      registry.register(createMockWorkflow("my-workflow"));

      expect(registry.get("my-workflow", "v1")).toBeUndefined();
    });

    test("returns the registered workflow", () => {
      const registry = new WorkflowRegistry();
      const workflow = createMockWorkflow("my-workflow");
      registry.register(workflow);

      expect(registry.get("my-workflow", null)).toBe(workflow);
    });
  });

  describe("getAll", () => {
    test("returns all registered workflows", () => {
      const registry = new WorkflowRegistry();
      const a = createMockWorkflow("workflow-a");
      const b = createMockWorkflow("workflow-b", "v1");
      const c = createMockWorkflow("workflow-a", "v2");

      registry.register(a);
      registry.register(b);
      registry.register(c);

      const all = registry.getAll();
      expect(all).toHaveLength(3);
      expect(all).toEqual(expect.arrayContaining([a, b, c]));
    });

    test("returns empty array when none registered", () => {
      const registry = new WorkflowRegistry();
      expect(registry.getAll()).toEqual([]);
    });
  });
});

function createMockWorkflow(name: string, version?: string) {
  return defineWorkflow(
    {
      name,
      ...(version && { version }),
    },
    async () => {
      // no-op
    },
  );
}
