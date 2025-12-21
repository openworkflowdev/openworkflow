import { createFileRoute } from '@tanstack/react-router'

import { AppLayout } from '@/components/app-layout'
import { WorkflowList } from '@/components/workflow-list'
import { WorkflowStats } from '@/components/workflow-stats'

export const Route = createFileRoute('/')({ component: HomePage })

function HomePage() {
  return (
    <AppLayout>
      <div className="space-y-8">
        <WorkflowStats />
        <WorkflowList />
      </div>
    </AppLayout>
  )
}
