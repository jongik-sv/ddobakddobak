import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('./components/editor/MeetingEditor', () => ({
  MeetingEditor: () => null,
  customSchema: { blockSpecs: {} },
}))

vi.mock('./hooks/useSttBlockInserter', () => ({
  useSttBlockInserter: vi.fn(),
}))

vi.mock('./components/meeting/mermaidBlock', () => ({
  MermaidBlock: {},
  editorSchema: { blockSpecs: {} },
  codeBlocksToMermaid: vi.fn((b: unknown[]) => b),
  mermaidToCodeBlocks: vi.fn((b: unknown[]) => b),
}))

vi.mock('@blocknote/react', () => ({
  useCreateBlockNote: vi.fn(() => ({
    document: [],
    replaceBlocks: vi.fn(),
    tryParseMarkdownToBlocks: vi.fn().mockResolvedValue([]),
    blocksToMarkdownLossy: vi.fn().mockResolvedValue(''),
  })),
  createReactBlockSpec: vi.fn(() => ({})),
  SuggestionMenuController: () => null,
  getDefaultReactSlashMenuItems: vi.fn(() => []),
}))

vi.mock('@blocknote/mantine', () => ({
  BlockNoteView: () => null,
}))

vi.mock('@blocknote/core', () => ({
  BlockNoteSchema: { create: vi.fn(() => ({ blockSpecs: {} })) },
  defaultBlockSpecs: {},
  insertOrUpdateBlockForSlashMenu: vi.fn(),
}))

vi.mock('./pages/ProjectSelectLanding', () => ({
  default: () => <div>LANDING_SENTINEL</div>,
}))

vi.mock('./config', () => ({
  getMode: () => 'local',
  IS_TAURI: false,
  IS_MOBILE: false,
  hasMode: () => true,
  getServerUrl: () => '',
  getDefaultServerUrl: () => '',
  getServerKey: () => 'local',
  getApiBaseUrl: () => '',
  getApiOrigin: () => '',
  getWsUrl: () => '',
  loadAppSettings: vi.fn(),
  AUDIO: {},
  AUDIO_DEFAULTS: {},
  LANGUAGES: [],
  MEETING_TYPES: [],
  SUMMARY_INTERVAL_OPTIONS: [],
  DEFAULT_SUMMARY_INTERVAL_SEC: 60,
  BREAKPOINTS: {},
  ENGINE_LABELS: {},
  BATCH_ENGINE_LABELS: {},
  ENGINE_LABELS_SHORT: {},
  DIARIZATION: {},
  DIARIZATION_DEFAULTS: {},
  initMobileBridge: vi.fn(),
  clearMode: vi.fn(),
}))

vi.mock('./hooks/useAuth', () => ({
  useAuth: () => ({ isAuthenticated: true, isLoading: false }),
}))

import App from './App'

describe('App 라우팅', () => {
  it('/ 경로에서 프로젝트 선택 랜딩을 렌더', async () => {
    localStorage.clear()
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>
    )
    expect(await screen.findByText('LANDING_SENTINEL')).toBeInTheDocument()
  })
})
