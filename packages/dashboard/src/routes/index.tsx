import { AppLayout } from "@/components/app-layout";
import { CreateRunForm } from "@/components/create-run-form";
import { RunList, type ChildRunRelation } from "@/components/run-list";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { WorkflowStats } from "@/components/workflow-stats";
import {
  getStepAttemptServerFn,
  getWorkflowRunCountsServerFn,
  getWorkflowRunServerFn,
  listWorkflowRunsServerFn,
} from "@/lib/api";
import {
  RUNS_PAGE_SIZE_OPTIONS,
  type RunsPaginationSearch,
  resolveRunsPageSize,
  shouldShowPaginationControls,
  validateRunsPaginationSearch,
} from "@/lib/runs-page-pagination";
import { usePolling } from "@/lib/use-polling";
import { PlusIcon } from "@phosphor-icons/react";
import { createFileRoute } from "@tanstack/react-router";
import type { StepAttempt, WorkflowRun } from "openworkflow/internal";
import { useState } from "react";

export const Route = createFileRoute("/")({
  validateSearch: validateRunsPaginationSearch,
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
  const pageSize = resolveRunsPageSize(search.limit);
  const runs = data;
  const showRunsPagination = shouldShowPaginationControls(pagination);

  function updateRunsSearch(next: Partial<RunsPaginationSearch>) {
    void navigate({
      to: "/",
      search: (previous) => ({
        ...previous,
        ...next,
      }),
    });
  }

  function handlePageSizeChange(value: string) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) {
      return;
    }

    const limit = resolveRunsPageSize(parsed);
    updateRunsSearch({
      limit,
      after: undefined,
      before: undefined,
    });
  }

  function goToNextPage() {
    if (!pagination.next) {
      return;
    }

    updateRunsSearch({
      after: pagination.next,
      before: undefined,
    });
  }

  function goToPreviousPage() {
    if (!pagination.prev) {
      return;
    }

    updateRunsSearch({
      before: pagination.prev,
      after: undefined,
    });
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
                Monitor and trigger workflow runs.
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

          <WorkflowStats workflowRunCounts={workflowRunCounts} />
          <div className="space-y-4">
            <RunList
              runs={runs}
              childRunRelationsByRunId={childRunRelationsByRunId}
              showHeader={false}
            />

            {showRunsPagination && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-muted-foreground text-xs">
                  Showing {runs.length} run{runs.length === 1 ? "" : "s"}
                </p>
                <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
                  <div className="flex items-center gap-2 sm:mr-1">
                    <p className="text-muted-foreground text-xs">Page size</p>
                    <Select
                      value={String(pageSize)}
                      onValueChange={handlePageSizeChange}
                    >
                      <SelectTrigger className="h-8 w-20">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {RUNS_PAGE_SIZE_OPTIONS.map((option) => (
                          <SelectItem key={option} value={String(option)}>
                            {option}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 sm:flex-none"
                    type="button"
                    onClick={goToPreviousPage}
                    disabled={!pagination.prev}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 sm:flex-none"
                    type="button"
                    onClick={goToNextPage}
                    disabled={!pagination.next}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogContent size="lg" className="gap-0 p-0">
          <DialogHeader className="border-border border-b px-4 py-3">
            <DialogTitle>Create Workflow Run</DialogTitle>
            <DialogDescription>
              Trigger a new workflow run directly from the dashboard.
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
