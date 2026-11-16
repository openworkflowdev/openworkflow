import { AppLayout } from "@/components/app-layout";
import { CreateRunForm } from "@/components/create-run-form";
import { ListPagination } from "@/components/list-pagination";
import { RunFiltersForm } from "@/components/run-filters-form";
import { RunList, type ChildRunRelation } from "@/components/run-list";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { WorkflowStats } from "@/components/workflow-stats";
import {
  getStepAttemptServerFn,
  getWorkflowRunCountsServerFn,
  getWorkflowRunServerFn,
  listWorkflowRunsServerFn,
} from "@/lib/api";
import { validateRunsSearch, type RunFilters } from "@/lib/run-filters";
import { resolveRunsPageSize } from "@/lib/runs-page-pagination";
import { usePolling } from "@/lib/use-polling";
import { PlusIcon } from "@phosphor-icons/react";
import { createFileRoute } from "@tanstack/react-router";
import type { StepAttempt, WorkflowRun } from "openworkflow/internal";
import { useState } from "react";

export const Route = createFileRoute("/")({
  validateSearch: validateRunsSearch,
  loaderDeps: ({ search }) => search,
  component: HomePage,
  loader: async ({ deps }) => {
    const limit = resolveRunsPageSize(deps.limit);

    const [runsResponse, workflowRunCounts] = await Promise.all([
      listWorkflowRunsServerFn({
        data: {
          limit,
          after: deps.after,
          before: deps.before,
          status: deps.status,
          workflowName: deps.workflowName,
        },
      }),
      getWorkflowRunCountsServerFn(),
    ]);
    const runs = runsResponse.data;
    const childRuns = runs.filter(
      (run): run is WorkflowRun & { parentStepAttemptId: string } =>
        run.parentStepAttemptId !== null && run.parentStepAttemptId !== "",
    );
    const parentStepAttemptIds = [
      ...new Set(childRuns.map((childRun) => childRun.parentStepAttemptId)),
    ];
    const parentStepAttemptsById: Record<string, StepAttempt | null> = {};
    await Promise.all(
      parentStepAttemptIds.map(async (parentStepAttemptId) => {
        parentStepAttemptsById[parentStepAttemptId] =
          await getStepAttemptServerFn({
            data: { stepAttemptId: parentStepAttemptId },
          });
      }),
    );
    const parentRunIds = [
      ...new Set(
        Object.values(parentStepAttemptsById)
          .map((parentStepAttempt) => parentStepAttempt?.workflowRunId)
          .filter((parentRunId): parentRunId is string => !!parentRunId),
      ),
    ];
    const parentRunsById: Record<string, WorkflowRun | null> = {};
    await Promise.all(
      parentRunIds.map(async (parentRunId) => {
        parentRunsById[parentRunId] = await getWorkflowRunServerFn({
          data: { workflowRunId: parentRunId },
        });
      }),
    );
    const childRunRelationsByRunId: Record<string, ChildRunRelation> = {};
    for (const childRun of childRuns) {
      const parentStepAttempt =
        parentStepAttemptsById[childRun.parentStepAttemptId];
      if (!parentStepAttempt) {
        continue;
      }

      const parentRun = parentRunsById[parentStepAttempt.workflowRunId];
      childRunRelationsByRunId[childRun.id] = {
        parentRunId: parentStepAttempt.workflowRunId,
        parentWorkflowName: parentRun?.workflowName ?? undefined,
      };
    }

    return {
      runsResponse,
      workflowRunCounts,
      childRunRelationsByRunId,
    };
  },
});

function HomePage() {
  const { runsResponse, workflowRunCounts, childRunRelationsByRunId } =
    Route.useLoaderData();
  const { data, pagination } = runsResponse;
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  const [isCreateRunOpen, setIsCreateRunOpen] = useState(false);
  const runs = data;
  let emptyMessage = "No workflow runs have been created yet.";
  if (search.after ?? search.before) {
    emptyMessage =
      "No runs on this page. Return to the first page to view runs.";
  } else if (search.status || search.workflowName) {
    emptyMessage =
      "No runs match these filters. Try changing or clearing them.";
  }

  function updateFilters(filters: RunFilters) {
    void navigate({ search: { limit: search.limit, ...filters } });
  }

  usePolling();

  return (
    <AppLayout>
      <Dialog open={isCreateRunOpen} onOpenChange={setIsCreateRunOpen}>
        <div className="space-y-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-2xl font-semibold">Workflow Runs</h2>
              <p className="text-muted-foreground mt-1 text-sm">
                Start workflows and check their progress.
              </p>
            </div>
            <Button
              type="button"
              onClick={() => {
                setIsCreateRunOpen(true);
              }}
            >
              <PlusIcon className="size-4" />
              New Run
            </Button>
          </div>

          <div className="space-y-3">
            <p className="text-muted-foreground text-xs">
              All runs in this namespace
            </p>
            <WorkflowStats
              workflowRunCounts={workflowRunCounts}
              selectedStatus={search.status}
              onStatusChange={(status) => {
                updateFilters({ status, workflowName: search.workflowName });
              }}
            />
          </div>
          <div className="space-y-4">
            <RunFiltersForm
              key={`${search.status ?? "all"}:${search.workflowName ?? ""}`}
              filters={search}
              onChange={updateFilters}
            />
            <RunList
              runs={runs}
              childRunRelationsByRunId={childRunRelationsByRunId}
              showHeader={false}
              emptyMessage={emptyMessage}
            />

            <ListPagination
              pagination={pagination}
              search={search}
              itemCount={runs.length}
              itemName="run"
              onChange={(next) => {
                void navigate({
                  search: {
                    ...next,
                    status: search.status,
                    workflowName: search.workflowName,
                  },
                });
              }}
            />
          </div>
        </div>

        <DialogContent size="lg" className="gap-0 p-0">
          <DialogHeader className="border-border border-b px-4 py-3">
            <DialogTitle>Create Workflow Run</DialogTitle>
            <DialogDescription>
              Choose a workflow and enter its input.
            </DialogDescription>
          </DialogHeader>
          <div className="p-4">
            <CreateRunForm
              onCancel={() => {
                setIsCreateRunOpen(false);
              }}
              onSuccess={() => {
                setIsCreateRunOpen(false);
              }}
            />
          </div>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
