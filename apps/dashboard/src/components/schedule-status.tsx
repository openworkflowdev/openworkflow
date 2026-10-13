import { Badge } from "./ui/badge";
import type { WorkflowSchedule } from "openworkflow";

export function ScheduleStatus({ schedule }: { schedule: WorkflowSchedule }) {
  return (
    <Badge
      variant="outline"
      className={
        schedule.nextRunAt === null
          ? "text-muted-foreground"
          : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
      }
    >
      <span className="size-1.5 rounded-full bg-current" />
      {schedule.nextRunAt === null ? "Paused" : "Active"}
    </Badge>
  );
}

export function ScheduleNextRun({ schedule }: { schedule: WorkflowSchedule }) {
  if (!schedule.nextRunAt)
    return (
      <span className="text-muted-foreground">
        No upcoming runs while paused
      </span>
    );
  return (
    <time dateTime={schedule.nextRunAt.toISOString()}>
      {new Intl.DateTimeFormat("en-US", {
        timeZone: schedule.timezone,
        dateStyle: "medium",
        timeStyle: "long",
      }).format(schedule.nextRunAt)}
    </time>
  );
}
