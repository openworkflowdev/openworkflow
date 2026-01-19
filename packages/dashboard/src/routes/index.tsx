import { AppLayout } from "@/components/app-layout";
import { ErrorDisplay } from "@/components/error-display";
import { RunList } from "@/components/run-list";
import { WorkflowStats } from "@/components/workflow-stats";
import { listWorkflowRunsServerFn } from "@/lib/api";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: HomePage,
  errorComponent: ({ error, reset }) => (
    <ErrorDisplay error={error} onRetry={reset} />
  ),
  loader: async () => {
    const result = await listWorkflowRunsServerFn({ data: { limit: 100 } });
    return result;
  },
});

function HomePage() {
  const { data: runs } = Route.useLoaderData();

  return (
    <AppLayout>
      <div className="space-y-8">
        <WorkflowStats runs={runs} />
        <RunList runs={runs} title="Recent Runs" />
      </div>
    </AppLayout>
  );
}
