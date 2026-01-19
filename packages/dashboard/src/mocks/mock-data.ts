import type { StepAttempt, Workflow, WorkflowRun } from "@/types";

export interface SystemStats {
  totalRuns: number;
  completed: number;
  running: number;
  failed: number;
  trends: {
    totalRunsChange: string;
    completedChange: string;
    runningChange: string;
    failedChange: string;
  };
}

export const systemStats: SystemStats = {
  totalRuns: 1247,
  completed: 1189,
  running: 23,
  failed: 35,
  trends: {
    totalRunsChange: "+12%",
    completedChange: "+8%",
    runningChange: "+3",
    failedChange: "-5%",
  },
};

export const workflows: Array<Workflow> = [
  {
    id: "send-welcome-email",
    name: "send-welcome-email",
    version: "v2",
    description: "Sends a personalized welcome email to new users",
    totalRuns: 342,
    recentRuns: { completed: 338, running: 2, failed: 2 },
    lastRun: "2m ago",
  },
  {
    id: "process-payment",
    name: "process-payment",
    version: "v1",
    description: "Handles payment processing and invoice generation",
    totalRuns: 156,
    recentRuns: { completed: 149, running: 3, failed: 4 },
    lastRun: "5m ago",
  },
  {
    id: "sync-user-data",
    name: "sync-user-data",
    version: "v1",
    description: "Synchronizes user data across multiple systems",
    totalRuns: 89,
    recentRuns: { completed: 86, running: 1, failed: 2 },
    lastRun: "12m ago",
  },
  {
    id: "send-notification",
    name: "send-notification",
    version: "v2",
    description: "Sends push notifications to user devices",
    totalRuns: 523,
    recentRuns: { completed: 498, running: 5, failed: 20 },
    lastRun: "18m ago",
  },
  {
    id: "process-order",
    name: "process-order",
    version: "v3",
    description: "Processes customer orders and updates inventory",
    totalRuns: 234,
    recentRuns: { completed: 228, running: 2, failed: 4 },
    lastRun: "25m ago",
  },
  {
    id: "generate-report",
    name: "generate-report",
    version: "v1",
    description: "Generates analytics reports and sends to stakeholders",
    totalRuns: 67,
    recentRuns: { completed: 62, running: 3, failed: 2 },
    lastRun: "32m ago",
  },
];

// Generate random run IDs
const generateRunId = () => {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "run_";
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

// Generate workflow runs for send-welcome-email
export const sendWelcomeEmailRuns: Array<WorkflowRun> = [
  {
    id: "run_b149ged2r",
    status: "running",
    startedAt: "2m ago",
    steps: { total: 8, completed: 1 },
    triggeredBy: "Manual",
  },
  {
    id: "run_upkuq2091",
    status: "failed",
    startedAt: "7m ago",
    duration: "0.6s",
    steps: { total: 5, completed: 6 },
    triggeredBy: "Schedule",
  },
  {
    id: "run_n4i11xnuh",
    status: "running",
    startedAt: "12m ago",
    duration: "2.9s",
    steps: { total: 9, completed: 5 },
    triggeredBy: "Api",
  },
  {
    id: "run_tejxv2gtl",
    status: "running",
    startedAt: "17m ago",
    duration: "2.8s",
    steps: { total: 7, completed: 6 },
    triggeredBy: "Api",
  },
  {
    id: "run_4tzh1kmb6",
    status: "running",
    startedAt: "22m ago",
    duration: "0.4s",
    steps: { total: 2, completed: 5 },
    triggeredBy: "Schedule",
  },
  {
    id: "run_stkr9np22",
    status: "pending",
    startedAt: "27m ago",
    duration: "2.5s",
    steps: { total: 9, completed: 3 },
    triggeredBy: "Api",
  },
  {
    id: "run_68rbxvukd",
    status: "failed",
    startedAt: "32m ago",
    duration: "3.8s",
    steps: { total: 5, completed: 6 },
    triggeredBy: "Api",
  },
  {
    id: "run_qzgmgfh5e",
    status: "pending",
    startedAt: "37m ago",
    duration: "2.4s",
    steps: { total: 6, completed: 7 },
    triggeredBy: "Manual",
  },
  {
    id: "run_tufsufpy",
    status: "pending",
    startedAt: "42m ago",
    duration: "1.8s",
    steps: { total: 4, completed: 2 },
    triggeredBy: "Api",
  },
  {
    id: "run_8xm2kvr7n",
    status: "completed",
    startedAt: "47m ago",
    duration: "1.2s",
    steps: { total: 8, completed: 8 },
    triggeredBy: "Schedule",
  },
];

// Generate runs for other workflows
export const processPaymentRuns: Array<WorkflowRun> = Array.from(
  { length: 30 },
  (_, i) => ({
    id: generateRunId(),
    status: ["completed", "running", "failed", "pending"][
      Math.floor(Math.random() * 4)
    ] as WorkflowRun["status"],
    startedAt: `${i * 5 + 2}m ago`,
    duration: `${(Math.random() * 5 + 0.5).toFixed(1)}s`,
    steps: {
      total: Math.floor(Math.random() * 10 + 3),
      completed: Math.floor(Math.random() * 8 + 1),
    },
    triggeredBy: (["Manual", "Schedule", "Api"] as const)[
      Math.floor(Math.random() * 3)
    ] as string,
  }),
);

// Detailed step data for a single run
export const runSteps: Array<StepAttempt> = [
  {
    name: "fetch-user",
    status: "completed",
    startedAt: "2m 5s ago",
    duration: "245ms",
    result: { userId: "12345", email: "user@example.com" },
  },
  {
    name: "send-email",
    status: "completed",
    startedAt: "2m 4s ago",
    duration: "823ms",
    result: { messageId: "msg_abc123", sent: true },
  },
  {
    name: "mark-welcome-email-sent",
    status: "completed",
    startedAt: "2m 3s ago",
    duration: "102ms",
    result: { updated: true },
  },
];

// Helper function to get workflow by ID
export function getWorkflowById(id: string): Workflow | undefined {
  return workflows.find((w) => w.id === id);
}

// Helper function to get runs by workflow ID
export function getRunsByWorkflowId(workflowId: string): Array<WorkflowRun> {
  if (workflowId === "send-welcome-email") {
    return sendWelcomeEmailRuns;
  }
  if (workflowId === "process-payment") {
    return processPaymentRuns;
  }
  // Return a default set for other workflows
  return Array.from({ length: 20 }, (_, i) => ({
    id: generateRunId(),
    status: ["completed", "running", "failed", "pending"][
      Math.floor(Math.random() * 4)
    ] as WorkflowRun["status"],
    startedAt: `${i * 3 + 1}m ago`,
    duration: `${(Math.random() * 4 + 0.3).toFixed(1)}s`,
    steps: {
      total: Math.floor(Math.random() * 8 + 2),
      completed: Math.floor(Math.random() * 6 + 1),
    },
    triggeredBy: (["Manual", "Schedule", "Api"] as const)[
      Math.floor(Math.random() * 3)
    ] as string,
  }));
}

// Helper function to get run by ID
export function getRunById(
  workflowId: string,
  runId: string,
): WorkflowRun | undefined {
  const runs = getRunsByWorkflowId(workflowId);
  return runs.find((r) => r.id === runId);
}

// Helper function to get stats by workflow ID
export function getWorkflowStats(workflowId: string) {
  const runs = getRunsByWorkflowId(workflowId);
  const completed = runs.filter((r) => r.status === "completed").length;
  const running = runs.filter((r) => r.status === "running").length;
  const failed = runs.filter((r) => r.status === "failed").length;

  return {
    totalRuns: runs.length,
    completed,
    running,
    failed,
  };
}
