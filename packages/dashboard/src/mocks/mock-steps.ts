import type { StepAttempt } from "@/types";

export const mockSteps: Array<StepAttempt> = [
  {
    name: "fetch-user",
    status: "completed",
    startedAt: "2m 5s ago",
    duration: "245ms",
    result: { id: "user_123", email: "user@example.com", name: "John Doe" },
  },
  {
    name: "send-email",
    status: "completed",
    startedAt: "2m 4s ago",
    duration: "823ms",
    result: { messageId: "msg_abc123", status: "sent" },
  },
  {
    name: "mark-welcome-email-sent",
    status: "completed",
    startedAt: "2m 3s ago",
    duration: "102ms",
    result: { success: true },
  },
];
