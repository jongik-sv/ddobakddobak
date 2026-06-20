import PromptTemplateManager from '../PromptTemplateManager'
import MeetingTemplateManager from './MeetingTemplateManager'

/** 회의록 설정 탭: 회의 템플릿 · 회의록 양식 */
export default function MeetingSettingsTab() {
  return (
    <div className="max-w-2xl space-y-6">
      <div className="rounded-lg border bg-card p-6">
        <h2 className="text-lg font-semibold mb-1">회의 템플릿</h2>
        <p className="text-sm text-muted-foreground mb-4">
          반복 회의(스탠드업, 주간회의 등) 설정을 템플릿으로 저장하고 재사용합니다.
        </p>
        <MeetingTemplateManager />
      </div>
      <PromptTemplateManager />
    </div>
  )
}
