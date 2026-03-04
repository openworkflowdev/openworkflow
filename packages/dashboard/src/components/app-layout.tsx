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
            <nav className="shrink-0 text-sm">
              <ModeSwitcher />
            </nav>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 sm:px-6 sm:py-8">
        {children}
      </main>
    </div>
  );
}
