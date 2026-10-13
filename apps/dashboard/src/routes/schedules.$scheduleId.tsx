import { AppLayout } from "@/components/app-layout";
import { ScheduleActions } from "@/components/schedule-actions";
import { ScheduleNextRun, ScheduleStatus } from "@/components/schedule-status";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getWorkflowScheduleServerFn } from "@/lib/api";
import { usePolling } from "@/lib/use-polling";
import { cn } from "@/lib/utils";
import { ArrowLeftIcon } from "@phosphor-icons/react";
import { createFileRoute, Link } from "@tanstack/react-router";
import type { WorkflowSchedule } from "openworkflow";

export const Route = createFileRoute("/schedules/$scheduleId")({
  loader: async ({ params }) =>
    getWorkflowScheduleServerFn({
      data: { workflowScheduleId: params.scheduleId },
    }),
  component: SchedulePage,
});

function SchedulePage() {
  const schedule = Route.useLoaderData();
  const { scheduleId } = Route.useParams();
  usePolling();

  return (
    <AppLayout>
      <div className="space-y-6">
        <Link
          to="/schedules"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-2 text-sm"
        >
          <ArrowLeftIcon />
          All schedules
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-2">
            <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Recurring schedule
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-2xl font-semibold break-all">{scheduleId}</h2>
              {schedule && <ScheduleStatus schedule={schedule} />}
            </div>
          </div>
          {schedule && <ScheduleActions schedule={schedule} />}
        </div>
        {schedule ? (
          <ScheduleOverview schedule={schedule} />
        ) : (
          <Card className="gap-2 p-6">
            <h3 className="font-semibold">Schedule not found</h3>
            <p className="text-muted-foreground text-sm">
              This schedule may have been deleted. Existing runs are on the Runs
              page.
            </p>
            <Link
              to="/"
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            >
              View Runs
            </Link>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}

function ScheduleOverview({ schedule }: { schedule: WorkflowSchedule }) {
  return (
    <Card className="gap-5 p-5 sm:p-6">
      <div className="border-border border-b pb-5">
        <p className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">
          Next run
        </p>
        <p className="text-lg font-medium">
          <ScheduleNextRun schedule={schedule} />
        </p>
        <p className="text-muted-foreground mt-2 text-sm">
          {schedule.nextRunAt === null
            ? "Existing runs continue. Resume to create the next run at its scheduled time."
            : "A running worker creates each scheduled run using the input below."}
        </p>
      </div>
      <dl className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Workflow", value: schedule.workflowName },
          { label: "Cron expression", value: schedule.cron },
          { label: "Time zone", value: schedule.timezone },
          { label: "Namespace", value: schedule.namespaceId },
        ].map(({ label, value }) => (
          <div key={label}>
            <dt className="text-muted-foreground mb-1 text-xs">{label}</dt>
            <dd className="font-mono text-sm break-all">{value}</dd>
          </div>
        ))}
      </dl>
      <details className="border-border rounded-md border p-4" open>
        <summary className="cursor-pointer text-sm font-medium">
          Workflow input
        </summary>
        <pre className="bg-muted/40 mt-3 max-h-64 overflow-auto rounded-md p-3 text-xs">
          <code>{JSON.stringify(schedule.input, null, 2)}</code>
        </pre>
      </details>
    </Card>
  );
}
