import type { WorkflowFunction } from "../execution/execution.js";

/**
 * Represents a workflow that can be executed by a worker.
 */
interface ExecutableWorkflow {
  fn: WorkflowFunction<unknown, unknown>;
}

/**
 * A registry for storing and retrieving workflows by name and version.
 * Provides a centralized way to manage workflow registrations.
 */
export class WorkflowRegistry<
  T extends ExecutableWorkflow = ExecutableWorkflow,
> {
  private readonly workflows = new Map<string, T>();

  /**
   * Register a workflow in the registry.
   * @param name - The workflow name
   * @param version - The workflow version (null for unversioned)
   * @param workflow - The workflow to register
   * @throws {Error} If a workflow with the same name and version is already registered
   */
  register(name: string, version: string | null, workflow: T): void {
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
  get(name: string, version: string | null): T | undefined {
    const key = registryKey(name, version);
    return this.workflows.get(key);
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
