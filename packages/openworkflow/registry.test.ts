import { WorkflowRegistry } from "./registry.js";
import { describe, expect, test } from "vitest";

describe("WorkflowRegistry", () => {
  describe("register", () => {
    test("registers a workflow without version", () => {
      const registry = new WorkflowRegistry();
      const workflow = createMockWorkflow();

      registry.register("my-workflow", null, workflow);

      expect(registry.get("my-workflow", null)).toBe(workflow);
    });

    test("registers a workflow with version", () => {
      const registry = new WorkflowRegistry();
      const workflow = createMockWorkflow();

      registry.register("my-workflow", "v1", workflow);

      expect(registry.get("my-workflow", "v1")).toBe(workflow);
    });

    test("registers multiple versions of the same workflow", () => {
      const registry = new WorkflowRegistry();
      const v1 = createMockWorkflow();
      const v2 = createMockWorkflow();

      registry.register("my-workflow", "v1", v1);
      registry.register("my-workflow", "v2", v2);

      expect(registry.get("my-workflow", "v1")).toBe(v1);
      expect(registry.get("my-workflow", "v2")).toBe(v2);
    });

    test("registers different workflows with same version", () => {
      const registry = new WorkflowRegistry();
      const workflow1 = createMockWorkflow();
      const workflow2 = createMockWorkflow();

      registry.register("workflow-a", "v1", workflow1);
      registry.register("workflow-b", "v1", workflow2);

      expect(registry.get("workflow-a", "v1")).toBe(workflow1);
      expect(registry.get("workflow-b", "v1")).toBe(workflow2);
    });

    test("throws when registering duplicate unversioned workflow", () => {
      const registry = new WorkflowRegistry();
      registry.register("my-workflow", null, createMockWorkflow());

      expect(() => {
        registry.register("my-workflow", null, createMockWorkflow());
      }).toThrow('Workflow "my-workflow" is already registered');
    });

    test("throws when registering duplicate versioned workflow", () => {
      const registry = new WorkflowRegistry();
      registry.register("my-workflow", "v1", createMockWorkflow());

      expect(() => {
        registry.register("my-workflow", "v1", createMockWorkflow());
      }).toThrow('Workflow "my-workflow" (version: v1) is already registered');
    });

    test("allows same name with different versions", () => {
      const registry = new WorkflowRegistry();
      const versioned = createMockWorkflow();
      const unversioned = createMockWorkflow();

      registry.register("my-workflow", "v1", versioned);
      registry.register("my-workflow", null, unversioned);

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
      registry.register("my-workflow", "v1", createMockWorkflow());

      expect(registry.get("my-workflow", "v2")).toBeUndefined();
      expect(registry.get("my-workflow", null)).toBeUndefined();
    });

    test("returns undefined for versioned lookup on unversioned workflow", () => {
      const registry = new WorkflowRegistry();
      registry.register("my-workflow", null, createMockWorkflow());

      expect(registry.get("my-workflow", "v1")).toBeUndefined();
    });

    test("returns the registered workflow", () => {
      const registry = new WorkflowRegistry();
      const workflow = createMockWorkflow();
      registry.register("my-workflow", null, workflow);

      expect(registry.get("my-workflow", null)).toBe(workflow);
    });
  });
});

function createMockWorkflow() {
  return {
    fn: async () => {
      // no-op
    },
  };
}
