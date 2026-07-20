import { useState, useEffect, useCallback } from 'react'
import { getLlmSettings, updateLlmSettings, testLlmConnection } from '../../api/settings'
import type { LlmSettings } from '../../api/settings'
import { listLlmProfiles, type LlmProfile } from '../../api/llmProfiles'
import LlmProfilesModal from './LlmProfilesModal'
import { LlmSelector, type LlmSelectorValue } from './LlmSelector'
import { CLI_PRESET_IDS } from './llmServicePresets'
import { getMode } from '../../config'
import { useAuthStore } from '../../stores/authStore'

// 응답 → 선택값 매핑(요약). 특수옵션 하나('none' = 선택 안함 — 요약 미실행).
const toSummarySel = (s: LlmSettings): LlmSelectorValue => {
  if (s.active_profile_id) return { type: 'profile', profileId: s.active_profile_id }
  if (s.active_preset === 'none') return { type: 'special', id: 'none' }
  if (s.active_preset && CLI_PRESET_IDS.has(s.active_preset))
    return { type: 'cli', presetId: s.active_preset, model: s.presets?.[s.active_preset]?.model ?? 'sonnet' }
  // 레거시 API 프리셋인데 프로필 미참조(이관 전·yaml 수동 편집 등) — 안전 폴백
  return { type: 'cli', presetId: 'claude_cli', model: 'sonnet' }
}

// 응답 → 선택값 매핑(챗). 특수옵션 하나('' = 요약과 동일).
const toChatSel = (s: LlmSettings): LlmSelectorValue => {
  if (s.chat_profile_id) return { type: 'profile', profileId: s.chat_profile_id }
  if (s.chat?.preset_id && CLI_PRESET_IDS.has(s.chat.preset_id))
    return { type: 'cli', presetId: s.chat.preset_id, model: s.chat.model ?? 'sonnet' }
  return { type: 'special', id: '' }
}

/** AI(LLM) 요약/챗 모델 설정 카드: 요약 카드 + AI 챗 카드 2분할. 서버 풀 프로필 또는 내장 CLI에서 선택. */
export function LlmSettingsPanel() {
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin')
  const [llmSettings, setLlmSettings] = useState<LlmSettings | null>(null)
  const [loading, setLoading] = useState(true)

  const [summarySel, setSummarySel] = useState<LlmSelectorValue>({ type: 'cli', presetId: 'claude_cli', model: 'sonnet' })
  const [chatSel, setChatSel] = useState<LlmSelectorValue>({ type: 'special', id: '' })
  // 챗='요약과 동일'(special '')일 때만 노출되는 레거시 챗 모델 오버라이드 입력값.
  const [chatFollowModel, setChatFollowModel] = useState('')
  const [profiles, setProfiles] = useState<LlmProfile[]>([])
  const [profilesModal, setProfilesModal] = useState<{ open: boolean; create: boolean }>({ open: false, create: false })

  const [llmSaving, setLlmSaving] = useState(false)
  const [llmSuccess, setLlmSuccess] = useState<string | null>(null)
  const [llmError, setLlmError] = useState<string | null>(null)
  const [llmTesting, setLlmTesting] = useState(false)
  const [llmTestResult, setLlmTestResult] = useState<{ success: boolean; error?: string } | null>(null)

  // 서버 응답을 진실로 선택값·챗 오버라이드 입력을 다시 채운다(최초 로드·저장 공통).
  const applySettings = useCallback((data: LlmSettings) => {
    setLlmSettings(data)
    setSummarySel(toSummarySel(data))
    setChatSel(toChatSel(data))
    setChatFollowModel(data.chat_model ?? '')
    setLlmTestResult(null)
  }, [])

  useEffect(() => {
    Promise.all([getLlmSettings(), listLlmProfiles('server')])
      .then(([data, profs]) => {
        setProfiles(profs)
        if (data) applySettings(data)
      })
      .catch(() => {
        setLlmError('설정을 불러오지 못했습니다.')
      })
      .finally(() => setLoading(false))
  }, [applySettings])

  // 서버 설정 카드는 로컬 모드이거나 admin일 때만 시스템 CLI를 노출한다(기존 규약 그대로).
  const cliAllowed = getMode() === 'local' || isAdmin

  const handleLlmTest = async () => {
    setLlmTesting(true)
    setLlmTestResult(null)
    try {
      let result: { success: boolean; error?: string }
      if (summarySel.type === 'profile') {
        const p = profiles.find((pr) => pr.id === summarySel.profileId)
        // base_url·profile_id 동봉 필수 — 없으면 커스텀 엔드포인트·서버 풀 토큰 폴백이 깨진다.
        result = await testLlmConnection({
          provider: p?.provider ?? '',
          model: p?.model ?? '',
          base_url: p?.base_url ?? undefined,
          profile_id: summarySel.profileId,
        })
      } else if (summarySel.type === 'cli') {
        result = await testLlmConnection({ provider: summarySel.presetId, model: summarySel.model })
      } else {
        return
      }
      setLlmTestResult(result)
    } catch {
      setLlmTestResult({ success: false, error: '테스트 요청에 실패했습니다.' })
    } finally {
      setLlmTesting(false)
    }
  }

  const handleLlmSave = async () => {
    setLlmSaving(true)
    setLlmError(null)
    setLlmSuccess(null)
    try {
      const summaryPayload =
        summarySel.type === 'profile'
          ? { active_profile_id: summarySel.profileId }
          : summarySel.type === 'cli'
            ? {
                // CLI는 provider==preset_id — 기존 yaml 스키마 그대로.
                active_preset: summarySel.presetId,
                preset_id: summarySel.presetId,
                preset_data: { provider: summarySel.presetId, model: summarySel.model },
                active_profile_id: null,
              }
            : { active_preset: 'none', active_profile_id: null }
      const chatPayload =
        chatSel.type === 'profile'
          ? { chat_profile_id: chatSel.profileId }
          : chatSel.type === 'cli'
            ? {
                chat: { preset_id: chatSel.presetId, provider: chatSel.presetId, model: chatSel.model },
                chat_profile_id: null,
              }
            : {
                chat: { provider: '' },
                chat_model: chatFollowModel || '',
                chat_profile_id: null,
              }

      const result = await updateLlmSettings({ ...summaryPayload, ...chatPayload })
      applySettings(result)
      setLlmSuccess('AI 설정이 저장되었습니다.')
    } catch {
      setLlmError('AI 설정 저장에 실패했습니다.')
    } finally {
      setLlmSaving(false)
    }
  }

  // 모달 CRUD 후 프로필 목록 갱신. 현재 선택 중인 프로필이 삭제돼 목록에서 사라지면
  // 선택이 dangling 상태(재저장 시 422)가 되므로 CLI/특수옵션 폴백으로 조정한다(I-2).
  const handleProfilesChanged = useCallback((next: LlmProfile[]) => {
    setProfiles(next)
    const ids = new Set(next.map((p) => p.id))
    setSummarySel((sel) =>
      sel.type === 'profile' && !ids.has(sel.profileId)
        ? { type: 'cli', presetId: 'claude_cli', model: 'sonnet' }
        : sel,
    )
    setChatSel((sel) => (sel.type === 'profile' && !ids.has(sel.profileId) ? { type: 'special', id: '' } : sel))
  }, [])

  const openManage = () => setProfilesModal({ open: true, create: false })
  const openCreate = () => setProfilesModal({ open: true, create: true })

  return (
    <div className="rounded-lg border bg-card p-6">
      <h2 className="text-lg font-semibold mb-1">LLM 모델 설정</h2>
      <p className="text-sm text-muted-foreground mb-4">
        회의록 요약에 사용할 AI 서비스를 선택합니다.
      </p>

      {loading && (
        <p className="text-sm text-muted-foreground" role="status">불러오는 중...</p>
      )}

      {!loading && (
        <div className="space-y-4">
          {/* 요약 모델 카드 — 특수옵션 '선택 안함'(선택 시 요약이 실행되지 않음) */}
          <LlmSelector
            title="요약 모델"
            idPrefix="summary"
            specialOptions={[{ id: 'none', label: '선택 안함', description: '요약을 실행하지 않습니다' }]}
            profiles={profiles}
            cliAllowed={cliAllowed}
            value={summarySel}
            onChange={setSummarySel}
            onManageProfiles={openManage}
            onCreateProfile={openCreate}
          />

          {/* AI 챗 모델 카드 */}
          <LlmSelector
            title="AI 챗 모델"
            idPrefix="chat"
            specialOptions={[{ id: '', label: '요약과 동일', description: '요약 모델 그대로 사용' }]}
            profiles={profiles}
            cliAllowed={cliAllowed}
            value={chatSel}
            onChange={setChatSel}
            onManageProfiles={openManage}
            onCreateProfile={openCreate}
          />

          {/* 레거시 챗 모델 입력 — 챗이 '요약과 동일'(special '')일 때만 표시 */}
          {chatSel.type === 'special' && chatSel.id === '' && (
            <div className="mt-2">
              <label htmlFor="chat-legacy-model" className="block text-xs text-muted-foreground mb-1">챗 모델</label>
              <input
                id="chat-legacy-model"
                value={chatFollowModel}
                onChange={(e) => setChatFollowModel(e.target.value)}
                placeholder="모델명을 입력하세요 (비우면 요약 모델)"
                className="w-full rounded-md border px-3 py-2 text-sm font-mono min-h-[44px]"
              />
            </div>
          )}

          {/* 요약 '선택 안함' + 챗 '요약과 동일' 조합이면 챗도 함께 멈춘다는 사실을 안내 */}
          {summarySel.type === 'special' && summarySel.id === 'none' && chatSel.type === 'special' && chatSel.id === '' && (
            <p className="text-sm text-muted-foreground">
              요약 모델이 '선택 안함'이면 AI 챗(요약과 동일)도 실행되지 않습니다.
            </p>
          )}

          {/* 버튼 + 결과 */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleLlmTest}
              disabled={llmTesting || summarySel.type === 'special'}
              className="px-4 py-2 rounded-md text-sm font-medium border border-blue-600 text-blue-600 hover:bg-blue-50 disabled:opacity-50 transition-colors min-h-[44px]"
            >
              {llmTesting ? '테스트 중...' : '연결 테스트'}
            </button>
            <button
              onClick={handleLlmSave}
              disabled={llmSaving}
              className="px-4 py-2 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors min-h-[44px]"
            >
              {llmSaving ? '저장 중...' : '저장'}
            </button>
          </div>
          {llmTestResult && (
            <p className={`text-sm ${llmTestResult.success ? 'text-green-600' : 'text-red-600'}`}>
              {llmTestResult.success ? '연결 성공' : `연결 실패: ${llmTestResult.error}`}
            </p>
          )}
          {llmError && <p className="text-sm text-red-600">{llmError}</p>}
          {llmSuccess && <p className="text-sm text-green-600">{llmSuccess}</p>}
          {llmSettings?.offline && (
            <p className="text-sm text-yellow-600">Sidecar 연결 불가 — 오프라인 상태</p>
          )}
        </div>
      )}

      <LlmProfilesModal
        scope="server"
        open={profilesModal.open}
        initialCreate={profilesModal.create}
        onClose={() => setProfilesModal((s) => ({ ...s, open: false }))}
        onChanged={handleProfilesChanged}
      />
    </div>
  )
}
