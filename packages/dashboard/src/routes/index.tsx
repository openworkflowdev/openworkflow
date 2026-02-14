import { AppLayout } from "@/components/app-layout";
import { CreateRunForm } from "@/components/create-run-form";
import { RunList } from "@/components/run-list";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { WorkflowStats } from "@/components/workflow-stats";
import { listWorkflowRunsServerFn } from "@/lib/api";
import { usePolling } from "@/lib/use-polling";
import { PlusIcon } from "@phosphor-icons/react";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

export const Route = createFileRoute("/")({
  component: HomePage,
  loader: async () => {
    const result = await listWorkflowRunsServerFn({ data: { limit: 100 } });
    return result;
  },
});

function HomePage() {
  const { data: runs } = Route.useLoaderData();
  const [isCreateRunOpen, setIsCreateRunOpen] = useState(false);
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

          <WorkflowStats runs={runs} />
          <RunList runs={runs} showHeader={false} />
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
