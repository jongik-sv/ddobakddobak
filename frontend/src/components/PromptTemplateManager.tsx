import { useState, useEffect, useCallback } from 'react'
import {
  getPromptTemplates,
  createPromptTemplate,
  updatePromptTemplate,
  deletePromptTemplate,
  resetPromptTemplate,
} from '../api/promptTemplates'
import type { PromptTemplate } from '../api/promptTemplates'

export default function PromptTemplateManager() {
  const [templates, setTemplates] = useState<PromptTemplate[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // 편집 폼 상태
  const [editLabel, setEditLabel] = useState('')
  const [editPrompt, setEditPrompt] = useState('')

  // 새 유형 추가 폼
  const [showAddForm, setShowAddForm] = useState(false)
  const [newType, setNewType] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [newPrompt, setNewPrompt] = useState('')

  const loadTemplates = useCallback(async () => {
    try {
      const data = await getPromptTemplates()
      setTemplates(data)
      if (data.length > 0 && selectedId === null) {
        selectTemplate(data[0])
      } else if (selectedId !== null) {
        const current = data.find((t) => t.id === selectedId)
        if (current) selectTemplate(current)
      }
    } catch {
      setError('프롬프트 템플릿을 불러오지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadTemplates()
  }, [loadTemplates])

  const selectTemplate = (t: PromptTemplate) => {
    setSelectedId(t.id)
    setEditLabel(t.label)
    setEditPrompt(t.sections_prompt)
    setError(null)
    setSuccess(null)
  }

  const selected = templates.find((t) => t.id === selectedId)
  const isDirty = selected
    ? editLabel !== selected.label || editPrompt !== selected.sections_prompt
    : false

  const handleSave = async () => {
    if (!selected || !isDirty) return
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const updated = await updatePromptTemplate(selected.id, {
        label: editLabel,
        sections_prompt: editPrompt,
      })
      setTemplates((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))
      selectTemplate(updated)
      setSuccess('저장되었습니다.')
    } catch {
      setError('저장에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }

  const handleReset = async () => {
    if (!selected || !selected.is_default) return
    if (!confirm('이 유형의 프롬프트를 기본값으로 복원하시겠습니까?')) return
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const updated = await resetPromptTemplate(selected.id)
      setTemplates((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))
      selectTemplate(updated)
      setSuccess('기본값으로 복원되었습니다.')
    } catch {
      setError('복원에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!selected || selected.is_default) return
    if (!confirm(`"${selected.label}" 유형을 삭제하시겠습니까?`)) return
    setSaving(true)
    setError(null)
    try {
      await deletePromptTemplate(selected.id)
      setTemplates((prev) => {
        const next = prev.filter((t) => t.id !== selected.id)
        if (next.length > 0) selectTemplate(next[0])
        else setSelectedId(null)
        return next
      })
      setSuccess('삭제되었습니다.')
    } catch {
      setError('삭제에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }

  const handleAdd = async () => {
    if (!newType.trim() || !newLabel.trim() || !newPrompt.trim()) return
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const created = await createPromptTemplate({
        meeting_type: newType.trim(),
        label: newLabel.trim(),
        sections_prompt: newPrompt.trim(),
      })
      setTemplates((prev) => [...prev, created])
      selectTemplate(created)
      setShowAddForm(false)
      setNewType('')
      setNewLabel('')
      setNewPrompt('')
      setSuccess('새 유형이 추가되었습니다.')
    } catch {
      setError('추가에 실패했습니다. 유형 코드가 중복되었을 수 있습니다.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="rounded-lg border bg-card p-6">
        <p className="text-sm text-muted-foreground">불러오는 중...</p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border bg-card p-6">
      <h2 className="text-lg font-semibold mb-1">회의록 양식 관리</h2>
      <p className="text-sm text-muted-foreground mb-4">
        회의 유형별 AI가 사용하는 회의록 구조 프롬프트를 편집합니다.
      </p>

      <div className="flex gap-4" style={{ minHeight: 360 }}>
        {/* 왼쪽: 유형 목록 */}
        <div className="w-44 shrink-0 space-y-1">
          {templates.map((t) => (
            <button
              key={t.id}
              onClick={() => selectTemplate(t)}
              className={`
                w-full text-left rounded-md px-3 py-2 text-sm transition-colors
                ${selectedId === t.id
                  ? 'bg-blue-50 text-blue-700 font-medium border border-blue-200'
                  : 'hover:bg-gray-50 text-gray-700 border border-transparent'
                }
              `}
            >
              <span>{t.label}</span>
              {!t.is_default && (
                <span className="ml-1 text-[10px] text-orange-500 font-medium">커스텀</span>
              )}
            </button>
          ))}

          <div className="border-t pt-2 mt-2">
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              className="w-full text-left rounded-md px-3 py-2 text-sm text-blue-600 hover:bg-blue-50 transition-colors font-medium"
            >
              + 새 유형 추가
            </button>
          </div>
        </div>

        {/* 오른쪽: 편집 영역 */}
        <div className="flex-1 min-w-0">
          {showAddForm ? (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-gray-800">새 회의 유형 추가</h3>
              <div>
                <label className="block text-sm font-medium mb-1">유형 코드</label>
                <input
                  type="text"
                  value={newType}
                  onChange={(e) => setNewType(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                  placeholder="예: daily_sync"
                  className="w-full rounded-md border px-3 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-ring"
                />
                <p className="text-xs text-muted-foreground mt-1">영문 소문자, 숫자, 밑줄만 사용 가능</p>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">표시 이름</label>
                <input
                  type="text"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder="예: 데일리 싱크"
                  className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">구조화 프롬프트</label>
                <textarea
                  value={newPrompt}
                  onChange={(e) => setNewPrompt(e.target.value)}
                  placeholder={'2. **구조화**: ...\n   - ## 섹션1 (...)\n   - ## 섹션2 (...)'}
                  rows={8}
                  className="w-full rounded-md border px-3 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-ring resize-y leading-relaxed"
                />
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleAdd}
                  disabled={saving || !newType.trim() || !newLabel.trim() || !newPrompt.trim()}
                  className="px-4 py-2 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {saving ? '추가 중...' : '추가'}
                </button>
                <button
                  onClick={() => { setShowAddForm(false); setNewType(''); setNewLabel(''); setNewPrompt('') }}
                  className="px-4 py-2 rounded-md text-sm font-medium border text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  취소
                </button>
              </div>
            </div>
          ) : selected ? (
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">표시 이름</label>
                <input
                  type="text"
                  value={editLabel}
                  onChange={(e) => setEditLabel(e.target.value)}
                  className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">구조화 프롬프트</label>
                <textarea
                  value={editPrompt}
                  onChange={(e) => setEditPrompt(e.target.value)}
                  rows={10}
                  className="w-full rounded-md border px-3 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-ring resize-y leading-relaxed"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  이 텍스트가 AI 시스템 프롬프트의 "구조화" 섹션을 대체합니다.
                  회의록의 섹션 구조를 정의하세요.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleSave}
                  disabled={saving || !isDirty}
                  className="px-4 py-2 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {saving ? '저장 중...' : '저장'}
                </button>
                {selected.is_default && (
                  <button
                    onClick={handleReset}
                    disabled={saving}
                    className="px-4 py-2 rounded-md text-sm font-medium border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                  >
                    기본값 복원
                  </button>
                )}
                {!selected.is_default && (
                  <button
                    onClick={handleDelete}
                    disabled={saving}
                    className="px-4 py-2 rounded-md text-sm font-medium border border-red-300 text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors"
                  >
                    삭제
                  </button>
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">왼쪽에서 유형을 선택하세요.</p>
          )}

          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
          {success && <p className="mt-3 text-sm text-green-600">{success}</p>}
        </div>
      </div>
    </div>
  )
}
