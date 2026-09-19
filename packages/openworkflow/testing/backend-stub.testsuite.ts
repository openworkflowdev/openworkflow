import type { Backend } from "../core/backend.js";

/**
 * Build a complete test backend that fails if an unexpected method is called.
 * @param overrides - Methods used by the test
 * @returns Backend with explicit implementations for every method
 */
export function createStubBackend(overrides: Partial<Backend>): Backend {
  return {
    createWorkflowRun: unexpectedBackendCall,
    getWorkflowRun: unexpectedBackendCall,
    listWorkflowRuns: unexpectedBackendCall,
    countWorkflowRuns: unexpectedBackendCall,
    claimWorkflowRun: unexpectedBackendCall,
    extendWorkflowRunLease: unexpectedBackendCall,
    sleepWorkflowRun: unexpectedBackendCall,
    completeWorkflowRun: unexpectedBackendCall,
    failWorkflowRun: unexpectedBackendCall,
    rescheduleWorkflowRunAfterFailedStepAttempt: unexpectedBackendCall,
    cancelWorkflowRun: unexpectedBackendCall,
    createStepAttempt: unexpectedBackendCall,
    getStepAttempt: unexpectedBackendCall,
    listStepAttempts: unexpectedBackendCall,
    completeStepAttempt: unexpectedBackendCall,
    failStepAttempt: unexpectedBackendCall,
    setStepAttemptChildWorkflowRun: unexpectedBackendCall,
    sendSignal: unexpectedBackendCall,
    getSignalDelivery: unexpectedBackendCall,
    stop: unexpectedBackendCall,
    ...overrides,
  };
}

function unexpectedBackendCall(): never {
  throw new Error("Unexpected backend call");
}
