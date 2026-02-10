import { AppLayout } from "@/components/app-layout";
import { RunList } from "@/components/run-list";
import { WorkflowStats } from "@/components/workflow-stats";
import { listWorkflowRunsServerFn } from "@/lib/api";
import { usePolling } from "@/lib/use-polling";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: HomePage,
  loader: async () => {
    const result = await listWorkflowRunsServerFn({ data: { limit: 100 } });
    return result;
  },
});

function HomePage() {
  const { data: runs } = Route.useLoaderData();
  usePolling();

  return (
    <AppLayout>
      <div className="space-y-8">
        <WorkflowStats runs={runs} />
        <RunList runs={runs} title="Recent Runs" />
      </div>
    </AppLayout>
  );
}
