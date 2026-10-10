import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { SharedKnowledgeBase } from '@shared/data/types/knowledge'

import { useKnowledgePage } from '../../KnowledgePageProvider'
import SharedKnowledgeBaseDetail from '../SharedKnowledgeBaseDetail'

vi.mock('../../KnowledgePageProvider', () => ({ useKnowledgePage: vi.fn() }))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

const mockUseKnowledgePage = vi.mocked(useKnowledgePage)

const createSharedKb = (overrides: Partial<SharedKnowledgeBase> = {}): SharedKnowledgeBase => ({
  id: 'k1',
  name: '101-结构所规范库',
  scope: 'dept',
  ...overrides
})

const mockSharedContext = (selectedSharedKb: SharedKnowledgeBase | undefined, chatTopicId: string | null) => {
  mockUseKnowledgePage.mockReturnValue({ selectedSharedKb, chatTopicId } as never)
}

describe('SharedKnowledgeBaseDetail', () => {
  it('renders the shared kb name and the department description', () => {
    mockSharedContext(createSharedKb(), 'topic-9')

    render(<SharedKnowledgeBaseDetail />)

    expect(screen.getByText('101-结构所规范库')).toBeInTheDocument()
    expect(screen.getByText('knowledge.shared.description.department')).toBeInTheDocument()
  })

  it('renders the public description for a public-scope shared kb', () => {
    mockSharedContext(createSharedKb({ id: 'k2', scope: 'public' }), 'topic-9')

    render(<SharedKnowledgeBaseDetail />)

    expect(screen.getByText('knowledge.shared.description.public')).toBeInTheDocument()
    expect(screen.queryByText('knowledge.shared.description.department')).not.toBeInTheDocument()
  })

  it('renders nothing when no shared kb is selected', () => {
    mockSharedContext(undefined, 'topic-9')

    render(<SharedKnowledgeBaseDetail />)

    expect(screen.queryByText('101-结构所规范库')).not.toBeInTheDocument()
  })

  it('hides the chat action when no pinned topic exists', () => {
    mockSharedContext(createSharedKb(), null)

    render(<SharedKnowledgeBaseDetail />)

    expect(screen.queryByText('knowledge.shared.open_chat')).not.toBeInTheDocument()
  })

  it('navigates to the pinned topic chat on action', () => {
    mockSharedContext(createSharedKb(), 'topic-9')
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)

    render(<SharedKnowledgeBaseDetail />)
    fireEvent.click(screen.getByText('knowledge.shared.open_chat'))

    expect(openSpy).toHaveBeenCalledWith('/app/chat?topicId=topic-9', '_self')
    openSpy.mockRestore()
  })

  it('encodes the topic id in the navigation url', () => {
    mockSharedContext(createSharedKb(), 'topic 9/1')
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)

    render(<SharedKnowledgeBaseDetail />)
    fireEvent.click(screen.getByText('knowledge.shared.open_chat'))

    expect(openSpy).toHaveBeenCalledWith('/app/chat?topicId=topic%209%2F1', '_self')
    openSpy.mockRestore()
  })
})
