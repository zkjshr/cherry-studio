import { Search, Store, X } from 'lucide-react'
import type { FC } from 'react'
import { useState } from 'react'

import { Button, Input } from '@cherrystudio/ui'
import { cn } from '@renderer/utils/style'

/**
 * 扩展页共用展示基元——MarketPage 与 SkillsBlock 双向引用，抽到这里避免循环依赖。
 */

/**
 * ZCode 风格插件头像：外层是主题色的圆角容器（半透明装饰圈），图形按 2/3
 * 尺寸居中——无论有无图标都保持同一个容器形态，避免图片加载失败时跳变。
 * 加载失败回退 Blocks 风格的 Store 线条图标。
 */
export const PluginIcon: FC<{ iconUrl?: string; size?: number; className?: string }> = ({
  iconUrl,
  size = 36,
  className
}) => {
  const [failed, setFailed] = useState(false)
  const showImage = Boolean(iconUrl) && !failed
  const graphicSize = Math.round((size * 2) / 3)
  return (
    <span
      data-ui="market.plugin-icon"
      aria-hidden="true"
      style={{ width: size, height: size }}
      className={cn(
        'flex shrink-0 select-none items-center justify-center rounded-xl bg-muted',
        !showImage && 'text-muted-foreground',
        className
      )}>
      {showImage ? (
        <img
          src={iconUrl}
          alt=""
          width={graphicSize}
          height={graphicSize}
          loading="lazy"
          draggable={false}
          className="object-contain"
          onError={() => setFailed(true)}
        />
      ) : (
        <Store size={Math.round(size * 0.42)} strokeWidth={1.5} />
      )}
    </span>
  )
}

/**
 * ZCode 风格分节标题：h2 + 一条分隔线，内容另起。
 * 与散落边框卡不同，分节靠这条线维持长列表的视觉节奏。
 */
export const StoreSection: FC<{
  title: string
  icon?: React.ReactNode
  children: React.ReactNode
  sectionKey?: string
}> = ({ title, icon, children, sectionKey }) => (
  <section className="flex flex-col" data-ui="market.section" data-section={sectionKey}>
    <div className="flex items-center gap-1.5 pb-2">
      {icon}
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
    </div>
    <div aria-hidden className="h-px bg-border" />
    <div className="mt-2">{children}</div>
  </section>
)

/** ZCode 风格搜索框：左侧放大镜、右侧清空按钮。 */
export const MarketSearchInput: FC<{
  value: string
  onChange: (value: string) => void
  placeholder: string
}> = ({ value, onChange, placeholder }) => (
  <div className="relative" data-ui="market.search">
    <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
    <Input
      type="search"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="h-9 rounded-xl pr-9 pl-9 [&::-webkit-search-cancel-button]:appearance-none"
    />
    {value && (
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="clear"
        className="absolute top-1/2 right-1 -translate-y-1/2 rounded-full text-muted-foreground"
        onClick={() => onChange('')}>
        <X className="size-3.5" />
      </Button>
    )}
  </div>
)
