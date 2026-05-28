import PromptTemplateManager from '../PromptTemplateManager'
import MeetingTemplateManager from './MeetingTemplateManager'
import { SttSettingsPanel } from './SttSettingsPanel'
import { LlmSettingsPanel } from './LlmSettingsPanel'
import { AudioChunkingPanel } from './AudioChunkingPanel'
import { HuggingFacePanel } from './HuggingFacePanel'
import { DiarizationPanel } from './DiarizationPanel'

export default function GlobalSettingsTab() {
  return (
    <div className="max-w-2xl space-y-6">
      <SttSettingsPanel />

      <LlmSettingsPanel />

      {/* 회의 템플릿 관리 */}
      <div className="rounded-lg border bg-card p-6">
        <h2 className="text-lg font-semibold mb-1">회의 템플릿</h2>
        <p className="text-sm text-muted-foreground mb-4">
          반복 회의(스탠드업, 주간회의 등) 설정을 템플릿으로 저장하고 재사용합니다.
        </p>
        <MeetingTemplateManager />
      </div>

      {/* 회의록 양식 관리 (중앙 집중관리) */}
      <PromptTemplateManager />

      <AudioChunkingPanel />

      <HuggingFacePanel />

      <DiarizationPanel />
    </div>
  )
}
