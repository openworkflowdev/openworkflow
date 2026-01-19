import { ModeSwitcher } from "./mode-switcher";
import { Separator } from "./ui/separator";
import { Link } from "@tanstack/react-router";

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  return (
    <div className="bg-background text-foreground min-h-screen">
      <header className="border-border border-b">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="size-8 bg-black"></div>
              <h1 className="text-xl font-semibold">OpenWorkflow</h1>
            </div>
            <nav className="flex items-center gap-6 text-sm">
              <Link
                to="/"
                className="transition-colors"
                activeProps={{
                  className: "text-foreground hover:text-primary",
                }}
                inactiveProps={{
                  className: "text-muted-foreground hover:text-foreground",
                }}
              >
                Workflows
              </Link>
              <Separator orientation="vertical" />
              <ModeSwitcher />
            </nav>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">{children}</main>
    </div>
  );
}
