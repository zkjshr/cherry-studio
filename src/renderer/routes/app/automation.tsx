import { createFileRoute } from '@tanstack/react-router'

import AutomationPage from '@renderer/pages/automation/AutomationPage'

export const Route = createFileRoute('/app/automation')({
  component: AutomationPage
})
