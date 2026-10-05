import { DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'

import { CHERRYAI_DEFAULT_UNIQUE_MODEL_ID } from './cherryai'

export const DEFAULT_ASSISTANT_NAME = 'TJAD 百事通' as const
export const DEFAULT_ASSISTANT_EMOJI = '😀' as const
export const DEFAULT_ASSISTANT_PROMPT = '' as const

export function getDefaultAssistantNameForLocale(_locale?: string | null): string {
  // 企业版统一品牌名：不再按语言区分。
  return DEFAULT_ASSISTANT_NAME
}

export const DEFAULT_ASSISTANT_SEED = {
  name: DEFAULT_ASSISTANT_NAME,
  emoji: DEFAULT_ASSISTANT_EMOJI,
  prompt: DEFAULT_ASSISTANT_PROMPT,
  description: '',
  modelId: CHERRYAI_DEFAULT_UNIQUE_MODEL_ID,
  settings: DEFAULT_ASSISTANT_SETTINGS
} as const
