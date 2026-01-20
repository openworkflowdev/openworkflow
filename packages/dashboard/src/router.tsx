// Import the generated route tree
import { routeTree } from "./routeTree.gen";
import { createRouter } from "@tanstack/react-router";

// Create a new router instance
export const getRouter = () => {
  const router = createRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
