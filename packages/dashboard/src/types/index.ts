export type WorkflowStatus = "completed" | "running" | "failed" | "pending";

export interface WorkflowRun {
  id: string;
  status: WorkflowStatus;
  startedAt: string;
  duration?: string;
  steps: {
    total: number;
    completed: number;
  };
  triggeredBy: string;
}

export interface Workflow {
  id: string;
  name: string;
  version: string;
  description: string;
  totalRuns: number;
  recentRuns: {
    completed: number;
    running: number;
    failed: number;
  };
  lastRun?: string;
}

export interface StepAttempt {
  name: string;
  status: "completed" | "running" | "failed" | "pending";
  startedAt: string;
  duration?: string;
  result?: any;
  error?: string;
}
