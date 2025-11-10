import { createFileRoute, Link } from '@tanstack/react-router';
import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { baseOptions } from '@/lib/layout.shared';
import { useTranslation } from '@/lib/translations';
import type { Locale } from '@/lib/i18n';
import { CodeBlock, Pre } from 'fumadocs-ui/components/codeblock';

export const Route = createFileRoute('/$lang/')({
  component: Home,
});

function Home() {
  const { lang } = Route.useParams();
  const { t } = useTranslation(lang as Locale);

  return (
    <HomeLayout {...baseOptions(lang as Locale)}>
      <div className="min-h-screen">
        {/* Hero Section */}
        <section className="container mx-auto px-4 py-20 md:py-32 text-center">
          <div className="max-w-4xl mx-auto space-y-8">
            {/* Badge */}
            <div className="inline-flex items-center px-3 py-1 rounded-full border border-fd-border bg-fd-muted/50 text-sm text-fd-muted-foreground">
              <span className="mr-2">🚀</span>
              <span>{t.landing.badge}</span>
            </div>

            {/* Heading */}
            <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold tracking-tight">
              {t.landing.hero.title}{' '}
              <span className="bg-linear-to-r from-blue-600 to-violet-600 bg-clip-text text-transparent">
                {t.landing.hero.titleHighlight}
              </span>
            </h1>

            {/* Subheading */}
            <p className="text-lg md:text-xl text-fd-muted-foreground max-w-2xl mx-auto leading-relaxed">
              {t.landing.hero.subtitle}
            </p>

            {/* CTA Buttons */}
            <div className="flex flex-col sm:flex-row gap-4 justify-center items-center pt-4">
              <Link
                to="/$lang/docs/$"
                params={{ lang, _splat: '' }}
                className="px-6 py-3 rounded-lg bg-fd-primary text-fd-primary-foreground font-semibold text-base hover:opacity-90 transition-opacity shadow-lg"
              >
                {t.landing.hero.getStarted}
              </Link>
              <a
                href="https://github.com/openworkflowdev/openworkflow"
                target="_blank"
                rel="noopener noreferrer"
                className="px-6 py-3 rounded-lg border border-fd-border bg-fd-background text-fd-foreground font-semibold text-base hover:bg-fd-muted/50 transition-colors"
              >
                {t.landing.hero.viewGithub}
              </a>
            </div>

            {/* Install Command */}
            <div className="pt-8">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-fd-muted/50 border border-fd-border font-mono text-sm">
                <span className="text-fd-muted-foreground">$</span>
                <span>{t.landing.hero.install}</span>
              </div>
            </div>
          </div>
        </section>

        {/* Code Example Section */}
        <section className="container mx-auto px-4 py-16">
          <div className="max-w-5xl mx-auto">
            <div className="rounded-2xl border border-fd-border bg-gradient-to-br from-fd-background to-fd-muted/20 p-8 shadow-2xl">
              <div className="flex items-center gap-2 mb-4">
                <div className="flex gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-red-500/60"></div>
                  <div className="w-3 h-3 rounded-full bg-yellow-500/60"></div>
                  <div className="w-3 h-3 rounded-full bg-green-500/60"></div>
                </div>
                <span className="text-sm text-fd-muted-foreground ml-2">
                  workflow.ts
                </span>
              </div>
              <CodeBlock lang="typescript">
                <Pre>
                  {`const sendWelcomeEmail = ow.defineWorkflow(
  { name: "send-welcome-email" },
  async ({ input, step }) => {
    // Step 1: Fetch user
    const user = await step.run({ name: "fetch-user" }, async () => {
      return await db.users.findOne({ id: input.userId });
    });

    // Step 2: Send email
    await step.run({ name: "send-email" }, async () => {
      return await resend.emails.send({
        to: user.email,
        subject: "Welcome!",
        html: "<h1>Welcome to our app!</h1>",
      });
    });

    return { success: true };
  }
);`}
                </Pre>
              </CodeBlock>
            </div>
          </div>
        </section>

        {/* Features Grid */}
        <section className="container mx-auto px-4 py-20">
          <div className="max-w-6xl mx-auto">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-bold mb-4">
                {t.landing.features.title}
              </h2>
              <p className="text-lg text-fd-muted-foreground max-w-2xl mx-auto">
                {t.landing.features.subtitle}
              </p>
            </div>

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {/* Feature 1 */}
              <div className="p-6 rounded-xl border border-fd-border bg-fd-card hover:shadow-lg transition-shadow">
                <div className="w-12 h-12 rounded-lg bg-blue-500/10 flex items-center justify-center mb-4">
                  <span className="text-2xl">💪</span>
                </div>
                <h3 className="text-xl font-semibold mb-2">
                  {t.landing.features.durableExecution.title}
                </h3>
                <p className="text-fd-muted-foreground">
                  {t.landing.features.durableExecution.description}
                </p>
              </div>

              {/* Feature 2 */}
              <div className="p-6 rounded-xl border border-fd-border bg-fd-card hover:shadow-lg transition-shadow">
                <div className="w-12 h-12 rounded-lg bg-violet-500/10 flex items-center justify-center mb-4">
                  <span className="text-2xl">🔄</span>
                </div>
                <h3 className="text-xl font-semibold mb-2">
                  {t.landing.features.stepMemoization.title}
                </h3>
                <p className="text-fd-muted-foreground">
                  {t.landing.features.stepMemoization.description}
                </p>
              </div>

              {/* Feature 3 */}
              <div className="p-6 rounded-xl border border-fd-border bg-fd-card hover:shadow-lg transition-shadow">
                <div className="w-12 h-12 rounded-lg bg-green-500/10 flex items-center justify-center mb-4">
                  <span className="text-2xl">🗄️</span>
                </div>
                <h3 className="text-xl font-semibold mb-2">
                  {t.landing.features.workerDriven.title}
                </h3>
                <p className="text-fd-muted-foreground">
                  {t.landing.features.workerDriven.description}
                </p>
              </div>

              {/* Feature 4 */}
              <div className="p-6 rounded-xl border border-fd-border bg-fd-card hover:shadow-lg transition-shadow">
                <div className="w-12 h-12 rounded-lg bg-orange-500/10 flex items-center justify-center mb-4">
                  <span className="text-2xl">⚡</span>
                </div>
                <h3 className="text-xl font-semibold mb-2">
                  {t.landing.features.typeSafe.title}
                </h3>
                <p className="text-fd-muted-foreground">
                  {t.landing.features.typeSafe.description}
                </p>
              </div>

              {/* Feature 5 */}
              <div className="p-6 rounded-xl border border-fd-border bg-fd-card hover:shadow-lg transition-shadow">
                <div className="w-12 h-12 rounded-lg bg-pink-500/10 flex items-center justify-center mb-4">
                  <span className="text-2xl">🚀</span>
                </div>
                <h3 className="text-xl font-semibold mb-2">
                  {t.landing.features.parallelExecution.title}
                </h3>
                <p className="text-fd-muted-foreground">
                  {t.landing.features.parallelExecution.description}
                </p>
              </div>

              {/* Feature 6 */}
              <div className="p-6 rounded-xl border border-fd-border bg-fd-card hover:shadow-lg transition-shadow">
                <div className="w-12 h-12 rounded-lg bg-cyan-500/10 flex items-center justify-center mb-4">
                  <span className="text-2xl">🔒</span>
                </div>
                <h3 className="text-xl font-semibold mb-2">
                  {t.landing.features.productionReady.title}
                </h3>
                <p className="text-fd-muted-foreground">
                  {t.landing.features.productionReady.description}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* How It Works */}
        <section className="container mx-auto px-4 py-20">
          <div className="max-w-5xl mx-auto">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-bold mb-4">
                {t.landing.howItWorks.title}
              </h2>
              <p className="text-lg text-fd-muted-foreground">
                {t.landing.howItWorks.subtitle}
              </p>
            </div>

            <div className="grid md:grid-cols-4 gap-8">
              {t.landing.howItWorks.steps.map((stepData, i) => {
                const colors = [
                  'blue-500',
                  'violet-500',
                  'green-500',
                  'orange-500',
                ];
                const color = colors[i];
                return (
                  <div key={i} className="text-center">
                    <div
                      className={`w-16 h-16 rounded-full bg-${color}/10 border-2 border-${color} flex items-center justify-center text-2xl font-bold text-${color} mx-auto mb-4`}
                    >
                      {i + 1}
                    </div>
                    <h3 className="font-semibold mb-2">{stepData.title}</h3>
                    <p className="text-sm text-fd-muted-foreground">
                      {stepData.description}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Use Cases */}
        <section className="container mx-auto px-4 py-20 bg-fd-muted/20">
          <div className="max-w-5xl mx-auto">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-bold mb-4">
                {t.landing.useCases.title}
              </h2>
              <p className="text-lg text-fd-muted-foreground">
                {t.landing.useCases.subtitle}
              </p>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              {t.landing.useCases.cases.map((useCase, i) => (
                <div
                  key={i}
                  className="p-6 rounded-xl bg-fd-background border border-fd-border"
                >
                  <h3 className="text-lg font-semibold mb-2">{useCase.title}</h3>
                  <p className="text-fd-muted-foreground text-sm">
                    {useCase.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="container mx-auto px-4 py-20">
          <div className="max-w-4xl mx-auto text-center">
            <h2 className="text-3xl md:text-4xl font-bold mb-6">
              {t.landing.cta.title}
            </h2>
            <p className="text-lg text-fd-muted-foreground mb-8 max-w-2xl mx-auto">
              {t.landing.cta.subtitle}
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                to="/$lang/docs/$"
                params={{ lang, _splat: 'getting-started' }}
                className="px-8 py-3 rounded-lg bg-fd-primary text-fd-primary-foreground font-semibold text-lg hover:opacity-90 transition-opacity shadow-lg"
              >
                {t.landing.cta.readDocs}
              </Link>
              <a
                href="https://github.com/openworkflowdev/openworkflow/tree/main/examples"
                target="_blank"
                rel="noopener noreferrer"
                className="px-8 py-3 rounded-lg border border-fd-border bg-fd-background text-fd-foreground font-semibold text-lg hover:bg-fd-muted/50 transition-colors"
              >
                {t.landing.cta.viewExamples}
              </a>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t border-fd-border py-8">
          <div className="container mx-auto px-4">
            <div className="flex flex-col md:flex-row justify-between items-center gap-4">
              <div className="text-sm text-fd-muted-foreground">
                {t.landing.footer.copyright}
              </div>
              <div className="flex gap-6">
                <a
                  href="https://github.com/openworkflowdev/openworkflow"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-fd-muted-foreground hover:text-fd-foreground transition-colors"
                >
                  {t.nav.github}
                </a>
                <Link
                  to="/$lang/docs/$"
                  params={{ lang, _splat: '' }}
                  className="text-sm text-fd-muted-foreground hover:text-fd-foreground transition-colors"
                >
                  {t.nav.docs}
                </Link>
                <a
                  href="https://github.com/openworkflowdev/openworkflow/issues"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-fd-muted-foreground hover:text-fd-foreground transition-colors"
                >
                  {t.nav.issues}
                </a>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </HomeLayout>
  );
}
