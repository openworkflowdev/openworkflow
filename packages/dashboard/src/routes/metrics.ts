import { getMetricsResponse } from "@/lib/metrics.server";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/metrics")({
  server: {
    handlers: {
      GET: async () => {
        return await getMetricsResponse();
      },
    },
  },
});
