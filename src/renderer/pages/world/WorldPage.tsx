import { Globe2, Loader2 } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { loggerService } from '@logger'
import { WebviewHost } from '@renderer/components/WebviewHost'
import type { WorldPresenceConfig } from '@shared/types/world'

const logger = loggerService.withContext('WorldPage')

/**
 * 小世界（Little World）页面：内嵌 webview 打开 world 服务（Three.js 园区）。
 *
 * webview 机制沿用 site 小程序的同一链路——共享 `WebviewHost` 组件 + `persist:webview`
 * 分区（主窗口已声明 `webviewTag: true`；mini-app 的 `will-attach-webview` 门只拦
 * `persist:miniapp:*` 分区，`WebviewService` 为 `persist:webview` 注入标注/键盘 preload）。
 * URL 携带 `cid` 与 `token`（World_GetConfig），一期 world 与网关共用令牌。
 */
const WorldPage: FC = () => {
  const { t } = useTranslation()
  const [config, setConfig] = useState<WorldPresenceConfig | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    window.api.world
      .getConfig()
      .then((value) => {
        if (!cancelled) setConfig(value)
      })
      .catch((error) => {
        logger.error('Failed to load world config', error as Error)
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (failed) {
    return <WorldNotice title={t('world.not_configured.title')} description={t('world.not_configured.description')} />
  }

  if (!config) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
      </div>
    )
  }

  if (!config.enabled || !config.url) {
    return <WorldNotice title={t('world.not_configured.title')} description={t('world.not_configured.description')} />
  }

  const url = `${config.url}/?cid=${encodeURIComponent(config.cid)}&token=${encodeURIComponent(config.token)}`

  return (
    <div className="h-full w-full">
      <WebviewHost
        id="world"
        src={url}
        partition="persist:webview"
        ariaLabel={t('sidebar.world')}
        testId="world-webview"
        style={{ width: '100%', height: '100%', display: 'inline-flex', backgroundColor: 'var(--background)' }}
      />
    </div>
  )
}

/** 未配置/加载失败时的引导文案页。 */
const WorldNotice: FC<{ title: string; description: string }> = ({ title, description }) => (
  <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
    <Globe2 className="size-10 text-muted-foreground" strokeWidth={1.4} />
    <div className="text-base font-medium">{title}</div>
    <p className="max-w-md text-sm leading-relaxed text-muted-foreground">{description}</p>
  </div>
)

export default WorldPage
