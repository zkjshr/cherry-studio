import { createFileRoute } from '@tanstack/react-router'

import MarketPage from '@renderer/pages/market/MarketPage'

export const Route = createFileRoute('/app/market')({
  component: MarketPage
})
