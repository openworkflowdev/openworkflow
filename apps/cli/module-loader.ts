import { createJiti, type Jiti, type JitiOptions } from "jiti";

/**
 * Create a loader using the requested file's nearest tsconfig when available.
 * @param filePath - Absolute path to the file being loaded.
 * @param options - Runtime import options.
 * @returns A loader with optional TypeScript path resolution.
 */
export function createModuleLoader(
  filePath: string,
  options: JitiOptions = {},
): Jiti {
  try {
    return createJiti(filePath, { ...options, tsconfigPaths: true });
  } catch {
    // Deployments may omit development dependencies referenced by tsconfig.
    // Fall back before executing user code so ordinary imports still work.
    return createJiti(filePath, { ...options, tsconfigPaths: false });
  }
}
