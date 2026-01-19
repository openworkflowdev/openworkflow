import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/workflows/$workflowId")({
  component: WorkflowLayout,
});

function WorkflowLayout() {
  return <Outlet />;
}
