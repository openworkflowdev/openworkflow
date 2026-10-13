import { AppLayout } from "@/components/app-layout";
import { ListPagination } from "@/components/list-pagination";
import { ScheduleEditor } from "@/components/schedule-editor";
import { ScheduleNextRun, ScheduleStatus } from "@/components/schedule-status";
import { Card } from "@/components/ui/card";
import { listWorkflowSchedulesServerFn } from "@/lib/api";
import {
  resolveRunsPageSize,
  validateRunsPaginationSearch,
} from "@/lib/runs-page-pagination";
import { usePolling } from "@/lib/use-polling";
import { CalendarDotsIcon, CaretRightIcon } from "@phosphor-icons/react";
import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/schedules/")({
  validateSearch: validateRunsPaginationSearch,
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) =>
    listWorkflowSchedulesServerFn({
      data: { ...deps, limit: resolveRunsPageSize(deps.limit) },
    }),
  component: SchedulesPage,
});

function SchedulesPage() {
  const { data: schedules, pagination } = Route.useLoaderData();
  const search = Route.useSearch();
  const hasCursor = !!(search.after ?? search.before);
  const navigate = Route.useNavigate();
  usePolling();

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-semibold">Schedules</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Run workflows on a recurring schedule.
            </p>
          </div>
          <ScheduleEditor />
        </div>
        {schedules.length === 0 ? (
          <Card className="flex items-center gap-3 px-6 py-16 text-center">
            <CalendarDotsIcon className="text-muted-foreground size-12" />
            <h3 className="text-lg font-semibold">
              {hasCursor ? "No schedules on this page" : "No schedules yet"}
            </h3>
            <p className="text-muted-foreground max-w-md text-sm">
              {hasCursor
                ? "Return to the first page to view schedules."
                : "Create a recurring schedule for an existing workflow."}
            </p>
          </Card>
        ) : (
          <Card className="divide-border gap-0 divide-y overflow-hidden py-0">
            {schedules.map((schedule) => (
              <Link
                key={schedule.id}
                to="/schedules/$scheduleId"
                params={{ scheduleId: schedule.id }}
                className="hover:bg-muted/40 grid items-center gap-4 px-5 py-5 sm:grid-cols-[1fr_1fr_auto]"
              >
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold break-all">
                      {schedule.id}
                    </span>
                    <ScheduleStatus schedule={schedule} />
                  </div>
                  <p className="text-muted-foreground text-sm break-all">
                    {schedule.workflowName}
                  </p>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                    <code>{schedule.cron}</code>
                    <span className="text-muted-foreground">
                      {schedule.timezone}
                    </span>
                  </div>
                </div>
                <div className="space-y-1 text-sm">
                  <p className="text-muted-foreground text-xs">Next run</p>
                  <ScheduleNextRun schedule={schedule} />
                </div>
                <CaretRightIcon className="text-muted-foreground hidden size-5 sm:block" />
              </Link>
            ))}
          </Card>
        )}
        <ListPagination
          pagination={pagination}
          search={search}
          itemCount={schedules.length}
          itemName="schedule"
          onChange={(next) => {
            void navigate({ search: next });
          }}
        />
      </div>
    </AppLayout>
  );
}
