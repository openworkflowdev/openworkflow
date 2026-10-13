import { ModeSwitcher } from "./mode-switcher";
import { Link } from "@tanstack/react-router";

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  return (
    <div className="bg-background text-foreground min-h-screen">
      <header className="border-border border-b">
        <div className="container mx-auto px-4 py-4 sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <Link
                to="/"
                className="text-foreground hover:text-primary flex min-w-0 items-center gap-3 transition-colors"
                aria-label="OpenWorkflow home"
              >
                <div className="size-8 shrink-0 bg-black" />
                <h1 className="truncate text-lg font-semibold sm:text-xl">
                  OpenWorkflow
                </h1>
              </Link>
            </div>
            <div className="shrink-0 text-sm">
              <ModeSwitcher />
            </div>
          </div>
          <nav aria-label="Main navigation" className="mt-4 flex gap-1 text-sm">
            <Link
              to="/"
              activeOptions={{ exact: true }}
              activeProps={{ className: "bg-muted text-foreground" }}
              className="text-muted-foreground hover:text-foreground rounded-md px-3 py-2"
            >
              Runs
            </Link>
            <Link
              to="/schedules"
              activeProps={{ className: "bg-muted text-foreground" }}
              className="text-muted-foreground hover:text-foreground rounded-md px-3 py-2"
            >
              Schedules
            </Link>
          </nav>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 sm:px-6 sm:py-8">
        {children}
      </main>
    </div>
  );
}
