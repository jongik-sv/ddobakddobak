import { SttSettingsPanel } from './SttSettingsPanel'
import { AudioChunkingPanel } from './AudioChunkingPanel'
import { HuggingFacePanel } from './HuggingFacePanel'
import { DiarizationPanel } from './DiarizationPanel'

/** 음성·인식 탭: STT 모델 · HuggingFace · 화자분리 · 오디오 청킹 */
export default function VoiceSettingsTab() {
  return (
    <div className="max-w-2xl space-y-6">
      <SttSettingsPanel />
      <HuggingFacePanel />
      <DiarizationPanel />
      <AudioChunkingPanel />
    </div>
  )
}
