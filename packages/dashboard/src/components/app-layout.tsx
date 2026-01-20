import { ModeSwitcher } from "./mode-switcher";
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
              <Link
                to="/"
                className="text-foreground hover:text-primary flex items-center gap-3 transition-colors"
                aria-label="OpenWorkflow home"
              >
                <div className="size-8 bg-black" />
                <h1 className="text-xl font-semibold">OpenWorkflow</h1>
              </Link>
            </div>
            <nav className="flex items-center gap-4 text-sm">
              <ModeSwitcher />
            </nav>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">{children}</main>
    </div>
  );
}
