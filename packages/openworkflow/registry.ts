import type { Workflow } from "./workflow.js";

/**
 * A registry for storing and retrieving workflows by name and version.
 * Provides a centralized way to manage workflow registrations.
 */
export class WorkflowRegistry {
  private readonly workflows = new Map<
    string,
    Workflow<unknown, unknown, unknown>
  >();

  /**
   * Register a workflow in the registry.
   * @param workflow - The workflow to register
   * @throws {Error} If a workflow with the same name and version is already registered
   */
  register(workflow: Workflow<unknown, unknown, unknown>): void {
    const name = workflow.spec.name;
    const version = workflow.spec.version ?? null;
    const key = registryKey(name, version);
    if (this.workflows.has(key)) {
      const versionStr = version ? ` (version: ${version})` : "";
      throw new Error(`Workflow "${name}"${versionStr} is already registered`);
    }
    this.workflows.set(key, workflow);
  }

  /**
   * Get a workflow from the registry by name and version.
   * @param name - The workflow name
   * @param version - The workflow version (null for unversioned)
   * @returns The workflow if found, undefined otherwise
   */
  get(
    name: string,
    version: string | null,
  ): Workflow<unknown, unknown, unknown> | undefined {
    const key = registryKey(name, version);
    return this.workflows.get(key);
  }

  /**
   * Get all registered workflows.
   * @returns Array of all registered workflows
   */
  getAll(): Workflow<unknown, unknown, unknown>[] {
    return [...this.workflows.values()];
  }
}

/**
 * Build a registry key from name and version.
 * @param name - Workflow name
 * @param version - Workflow version (or null)
 * @returns Registry key
 */
function registryKey(name: string, version: string | null): string {
  return version ? `${name}@${version}` : name;
}
