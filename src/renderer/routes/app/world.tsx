import { createFileRoute } from '@tanstack/react-router'

import WorldPage from '@renderer/pages/world/WorldPage'

export const Route = createFileRoute('/app/world')({
  component: WorldPage
})
