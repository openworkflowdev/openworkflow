export const en = {
  // Navigation
  nav: {
    title: 'OpenWorkflow',
    docs: 'Documentation',
    issues: 'Issues',
  },

  // Landing Page
  landing: {
    badge: 'v0.1 - Active Development',
    hero: {
      title: 'Durable Workflows,',
      titleHighlight: 'Without the Complexity',
      subtitle:
        'OpenWorkflow is a TypeScript framework for building reliable, long-running applications that survive crashes and deploys—all without extra servers to manage.',
      getStarted: 'Get Started',
      viewGithub: 'View on GitHub',
      install: 'npm install openworkflow @openworkflow/backend-postgres',
    },
    features: {
      title: 'Why OpenWorkflow?',
      subtitle:
        'Build reliable workflows with automatic retries, crash recovery, and zero operational overhead.',
      durableExecution: {
        title: 'Durable Execution',
        description:
          'Workflows survive crashes, restarts, and deploys. Resume exactly where they left off.',
      },
      stepMemoization: {
        title: 'Step Memoization',
        description:
          'Each step executes exactly once. Results are cached and reused on retry.',
      },
      workerDriven: {
        title: 'Worker-Driven',
        description:
          'No separate orchestrator. Just workers and a database. Simple to operate.',
      },
      typeSafe: {
        title: 'Type-Safe',
        description:
          'Full TypeScript support with generics. Catch errors at compile-time.',
      },
      parallelExecution: {
        title: 'Parallel Execution',
        description:
          'Run steps concurrently with Promise.all. Maximize throughput.',
      },
      productionReady: {
        title: 'Production Ready',
        description:
          'Graceful shutdown, monitoring, and battle-tested PostgreSQL backend.',
      },
    },
    howItWorks: {
      title: 'How It Works',
      subtitle: 'Simple architecture, powerful guarantees',
      steps: [
        {
          title: 'Define',
          description: 'Write workflows with steps as checkpoints',
        },
        {
          title: 'Start',
          description: 'Workers poll database for pending workflows',
        },
        {
          title: 'Execute',
          description: 'Steps run and results are cached',
        },
        {
          title: 'Resume',
          description: 'Crashes? Another worker picks up instantly',
        },
      ],
    },
    useCases: {
      title: 'Built for Real Applications',
      subtitle: 'From simple tasks to complex business processes',
      cases: [
        {
          title: '💳 Payment Processing',
          description:
            'Charge cards, update inventory, send receipts—all with automatic retry and rollback support.',
        },
        {
          title: '📧 Email Campaigns',
          description:
            'Send personalized emails at scale with progress tracking and delivery guarantees.',
        },
        {
          title: '🔄 Data Pipelines',
          description:
            'Extract, transform, and load data with checkpointing and automatic recovery.',
        },
        {
          title: '🛒 Order Fulfillment',
          description:
            'Coordinate inventory, shipping, and notifications in one reliable workflow.',
        },
      ],
    },
    cta: {
      title: 'Ready to build reliable workflows?',
      subtitle:
        'Get started in minutes with our comprehensive documentation and examples.',
      readDocs: 'Read the Docs',
      viewExamples: 'View Examples',
    },
    footer: {
      copyright: '© 2024 OpenWorkflow. Apache 2.0 License.',
    },
  },

  // Common
  common: {
    close: 'Close',
    copy: 'Copy',
    copied: 'Copied!',
    search: 'Search...',
    searchPlaceholder: 'Search...',
    theme: {
      light: 'Light',
      dark: 'Dark',
      system: 'System',
    },
  },
} as const;

export type Translation = typeof en;
