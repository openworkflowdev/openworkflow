import { createFileRoute, Link } from '@tanstack/react-router';
import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { baseOptions } from '@/lib/layout.shared';

export const Route = createFileRoute('/')({
  component: Home,
});

function Home() {
  return (
    <HomeLayout {...baseOptions()}>
      <div className="min-h-screen">
        {/* Hero Section */}
        <section className="container mx-auto px-4 py-20 md:py-32 text-center">
          <div className="max-w-4xl mx-auto space-y-8">
            {/* Badge */}
            <div className="inline-flex items-center px-3 py-1 rounded-full border border-fd-border bg-fd-muted/50 text-sm text-fd-muted-foreground">
              <span className="mr-2">🚀</span>
              <span>v0.1 - Active Development</span>
            </div>

            {/* Heading */}
            <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold tracking-tight">
              Durable Workflows,{' '}
              <span className="bg-gradient-to-r from-blue-600 to-violet-600 bg-clip-text text-transparent">
                Without the Complexity
              </span>
            </h1>

            {/* Subheading */}
            <p className="text-lg md:text-xl text-fd-muted-foreground max-w-2xl mx-auto leading-relaxed">
              OpenWorkflow is a TypeScript framework for building reliable, long-running applications that survive crashes and deploys—all without extra servers to manage.
            </p>

            {/* CTA Buttons */}
            <div className="flex flex-col sm:flex-row gap-4 justify-center items-center pt-4">
              <Link
                to="/docs/$"
                params={{ _splat: '' }}
                className="px-6 py-3 rounded-lg bg-fd-primary text-fd-primary-foreground font-semibold text-base hover:opacity-90 transition-opacity shadow-lg"
              >
                Get Started
              </Link>
              <a
                href="https://github.com/openworkflowdev/openworkflow"
                target="_blank"
                rel="noopener noreferrer"
                className="px-6 py-3 rounded-lg border border-fd-border bg-fd-background text-fd-foreground font-semibold text-base hover:bg-fd-muted/50 transition-colors"
              >
                View on GitHub
              </a>
            </div>

            {/* Install Command */}
            <div className="pt-8">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-fd-muted/50 border border-fd-border font-mono text-sm">
                <span className="text-fd-muted-foreground">$</span>
                <span>npm install openworkflow @openworkflow/backend-postgres</span>
              </div>
            </div>
          </div>
        </section>



        {/* Features Grid */}
        <section className="container mx-auto px-4 py-20">
          <div className="max-w-6xl mx-auto">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-bold mb-4">
                Why OpenWorkflow?
              </h2>
              <p className="text-lg text-fd-muted-foreground max-w-2xl mx-auto">
                Build reliable workflows with automatic retries, crash recovery, and zero operational overhead.
              </p>
            </div>

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {/* Feature 1 */}
              <div className="p-6 rounded-xl border border-fd-border bg-fd-card hover:shadow-lg transition-shadow">
                <div className="w-12 h-12 rounded-lg bg-blue-500/10 flex items-center justify-center mb-4">
                  <span className="text-2xl">💪</span>
                </div>
                <h3 className="text-xl font-semibold mb-2">Durable Execution</h3>
                <p className="text-fd-muted-foreground">
                  Workflows survive crashes, restarts, and deploys. Resume exactly where they left off.
                </p>
              </div>

              {/* Feature 2 */}
              <div className="p-6 rounded-xl border border-fd-border bg-fd-card hover:shadow-lg transition-shadow">
                <div className="w-12 h-12 rounded-lg bg-violet-500/10 flex items-center justify-center mb-4">
                  <span className="text-2xl">🔄</span>
                </div>
                <h3 className="text-xl font-semibold mb-2">Step Memoization</h3>
                <p className="text-fd-muted-foreground">
                  Each step executes exactly once. Results are cached and reused on retry.
                </p>
              </div>

              {/* Feature 3 */}
              <div className="p-6 rounded-xl border border-fd-border bg-fd-card hover:shadow-lg transition-shadow">
                <div className="w-12 h-12 rounded-lg bg-green-500/10 flex items-center justify-center mb-4">
                  <span className="text-2xl">🗄️</span>
                </div>
                <h3 className="text-xl font-semibold mb-2">Worker-Driven</h3>
                <p className="text-fd-muted-foreground">
                  No separate orchestrator. Just workers and a database. Simple to operate.
                </p>
              </div>

              {/* Feature 4 */}
              <div className="p-6 rounded-xl border border-fd-border bg-fd-card hover:shadow-lg transition-shadow">
                <div className="w-12 h-12 rounded-lg bg-orange-500/10 flex items-center justify-center mb-4">
                  <span className="text-2xl">⚡</span>
                </div>
                <h3 className="text-xl font-semibold mb-2">Type-Safe</h3>
                <p className="text-fd-muted-foreground">
                  Full TypeScript support with generics. Catch errors at compile-time.
                </p>
              </div>

              {/* Feature 5 */}
              <div className="p-6 rounded-xl border border-fd-border bg-fd-card hover:shadow-lg transition-shadow">
                <div className="w-12 h-12 rounded-lg bg-pink-500/10 flex items-center justify-center mb-4">
                  <span className="text-2xl">🚀</span>
                </div>
                <h3 className="text-xl font-semibold mb-2">Parallel Execution</h3>
                <p className="text-fd-muted-foreground">
                  Run steps concurrently with Promise.all. Maximize throughput.
                </p>
              </div>

              {/* Feature 6 */}
              <div className="p-6 rounded-xl border border-fd-border bg-fd-card hover:shadow-lg transition-shadow">
                <div className="w-12 h-12 rounded-lg bg-cyan-500/10 flex items-center justify-center mb-4">
                  <span className="text-2xl">🔒</span>
                </div>
                <h3 className="text-xl font-semibold mb-2">Production Ready</h3>
                <p className="text-fd-muted-foreground">
                  Graceful shutdown, monitoring, and battle-tested PostgreSQL backend.
                </p>
              </div>
            </div>
          </div>
        </section>



        {/* Use Cases */}
        <section className="container mx-auto px-4 py-20 bg-fd-muted/20">
          <div className="max-w-5xl mx-auto">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-bold mb-4">
                Built for Real Applications
              </h2>
              <p className="text-lg text-fd-muted-foreground">
                From simple tasks to complex business processes
              </p>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              <div className="p-6 rounded-xl bg-fd-background border border-fd-border">
                <h3 className="text-lg font-semibold mb-2">💳 Payment Processing</h3>
                <p className="text-fd-muted-foreground text-sm">
                  Charge cards, update inventory, send receipts—all with automatic retry and rollback support.
                </p>
              </div>

              <div className="p-6 rounded-xl bg-fd-background border border-fd-border">
                <h3 className="text-lg font-semibold mb-2">📧 Email Campaigns</h3>
                <p className="text-fd-muted-foreground text-sm">
                  Send personalized emails at scale with progress tracking and delivery guarantees.
                </p>
              </div>

              <div className="p-6 rounded-xl bg-fd-background border border-fd-border">
                <h3 className="text-lg font-semibold mb-2">🔄 Data Pipelines</h3>
                <p className="text-fd-muted-foreground text-sm">
                  Extract, transform, and load data with checkpointing and automatic recovery.
                </p>
              </div>

              <div className="p-6 rounded-xl bg-fd-background border border-fd-border">
                <h3 className="text-lg font-semibold mb-2">🛒 Order Fulfillment</h3>
                <p className="text-fd-muted-foreground text-sm">
                  Coordinate inventory, shipping, and notifications in one reliable workflow.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="container mx-auto px-4 py-20">
          <div className="max-w-4xl mx-auto text-center">
            <h2 className="text-3xl md:text-4xl font-bold mb-6">
              Ready to build reliable workflows?
            </h2>
            <p className="text-lg text-fd-muted-foreground mb-8 max-w-2xl mx-auto">
              Get started in minutes with our comprehensive documentation and examples.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                to="/docs/$"
                params={{ _splat: 'getting-started' }}
                className="px-8 py-3 rounded-lg bg-fd-primary text-fd-primary-foreground font-semibold text-lg hover:opacity-90 transition-opacity shadow-lg"
              >
                Read the Docs
              </Link>
              <a
                href="https://github.com/openworkflowdev/openworkflow/tree/main/examples"
                target="_blank"
                rel="noopener noreferrer"
                className="px-8 py-3 rounded-lg border border-fd-border bg-fd-background text-fd-foreground font-semibold text-lg hover:bg-fd-muted/50 transition-colors"
              >
                View Examples
              </a>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t border-fd-border py-8">
          <div className="container mx-auto px-4">
            <div className="flex flex-col md:flex-row justify-between items-center gap-4">
              <div className="text-sm text-fd-muted-foreground">
                © 2024 OpenWorkflow. Apache 2.0 License.
              </div>
              <div className="flex gap-6">
                <a
                  href="https://github.com/openworkflowdev/openworkflow"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-fd-muted-foreground hover:text-fd-foreground transition-colors"
                >
                  GitHub
                </a>
                <Link
                  to="/docs/$"
                  params={{ _splat: '' }}
                  className="text-sm text-fd-muted-foreground hover:text-fd-foreground transition-colors"
                >
                  Documentation
                </Link>
                <a
                  href="https://github.com/openworkflowdev/openworkflow/issues"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-fd-muted-foreground hover:text-fd-foreground transition-colors"
                >
                  Issues
                </a>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </HomeLayout>
  );
}
