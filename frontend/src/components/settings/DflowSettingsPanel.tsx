import { useState, useEffect } from 'react'
import { HTTPError } from 'ky'
import { getDflowSettings, updateDflowSettings, getDflowMeta } from '../../api/dflow'
import type { DflowSettings, DflowMeta } from '../../api/dflow'
import { PasswordInput } from '../ui/PasswordInput'

/** D'Flow(회의록 아카이브) 연동 설정 카드: 활성화 · 서버 주소 · 시크릿 · 연결 테스트. */
export function DflowSettingsPanel() {
  const [settings, setSettings] = useState<DflowSettings | null>(null)
  const [loading, setLoading] = useState(true)

  const [enabled, setEnabled] = useState(false)
  const [baseUrl, setBaseUrl] = useState('')
  const [apiSecret, setApiSecret] = useState('')

  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<
    { success: true; meta: DflowMeta } | { success: false; error: string } | null
  >(null)

  useEffect(() => {
    getDflowSettings()
      .then((data) => {
        setSettings(data)
        setEnabled(data.enabled)
        setBaseUrl(data.base_url ?? '')
      })
      .catch(() => setError('설정을 불러오지 못했습니다.'))
      .finally(() => setLoading(false))
  }, [])

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const params: { enabled: boolean; base_url: string; api_secret?: string } = {
        enabled,
        base_url: baseUrl,
      }
      // 마스킹 값 재전송 방지: 사용자가 입력했을 때만 포함.
      if (apiSecret) params.api_secret = apiSecret

      const result = await updateDflowSettings(params)
      setSettings(result)
      setEnabled(result.enabled)
      setBaseUrl(result.base_url ?? '')
      setApiSecret('')
      setSuccess('D\'Flow 설정이 저장되었습니다.')
    } catch {
      setError('D\'Flow 설정 저장에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const meta = await getDflowMeta()
      setTestResult({ success: true, meta })
    } catch (err) {
      if (err instanceof HTTPError) {
        const body = (await err.response.json().catch(() => ({}))) as { error?: string; code?: string }
        if (body.code === 'dflow_auth_error') {
          setTestResult({ success: false, error: '시크릿 불일치 또는 미개통/URL 오류' })
        } else if (body.code === 'dflow_connection_error') {
          setTestResult({ success: false, error: 'D\'Flow 서버에 연결할 수 없습니다.' })
        } else {
          setTestResult({ success: false, error: body.error ?? '연결 테스트에 실패했습니다.' })
        }
      } else {
        setTestResult({ success: false, error: '연결 테스트에 실패했습니다.' })
      }
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="rounded-lg border bg-card p-6">
      <h2 className="text-lg font-semibold mb-1">D'Flow 연동</h2>
      <p className="text-sm text-muted-foreground mb-4">
        회의록을 D'Flow(회의록 아카이브)로 전송하는 연동 설정입니다.
      </p>

      {loading && (
        <p className="text-sm text-muted-foreground" role="status">불러오는 중...</p>
      )}

      {!loading && (
        <div className="space-y-4">
          <div className="flex items-center justify-between py-3 px-4 bg-muted rounded-lg">
            <div>
              <p className="text-sm font-medium text-foreground">D'Flow 연동 사용</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                켜면 회의록 화면에서 D'Flow로 전송할 수 있습니다.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              onClick={() => setEnabled((v) => !v)}
              className={[
                'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent',
                'transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2',
                enabled ? 'bg-blue-600' : 'bg-gray-200',
              ].join(' ')}
            >
              <span
                className={[
                  'pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0',
                  'transition duration-200 ease-in-out',
                  enabled ? 'translate-x-5' : 'translate-x-0',
                ].join(' ')}
              />
            </button>
          </div>

          <div>
            <label htmlFor="dflow-base-url" className="block text-sm font-medium mb-1">서버 주소</label>
            <input
              id="dflow-base-url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://dflow.example.com"
              className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring font-mono min-h-[44px]"
            />
          </div>

          <div>
            <label htmlFor="dflow-api-secret" className="block text-sm font-medium mb-1">API 시크릿</label>
            <PasswordInput
              id="dflow-api-secret"
              value={apiSecret}
              onChange={(e) => setApiSecret(e.target.value)}
              placeholder={settings?.api_secret_masked || '시크릿을 입력하세요'}
              toggleLabel="API 시크릿"
              className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring font-mono min-h-[44px]"
            />
            {settings?.api_secret_masked && !apiSecret && (
              <p className="text-xs text-muted-foreground mt-1">현재: {settings.api_secret_masked}</p>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            최상위 폴더명이 D'Flow 구분과 일치하면 자동 선택됩니다. 전송 제목은 &lt;하위폴더명&gt;-&lt;원제목&gt;으로 자동 조립됩니다.
          </p>

          <div className="flex items-center gap-2">
            <button
              onClick={handleTest}
              disabled={testing}
              className="px-4 py-2 rounded-md text-sm font-medium border border-blue-600 text-blue-600 hover:bg-blue-50 disabled:opacity-50 transition-colors min-h-[44px]"
            >
              {testing ? '테스트 중...' : '연결 테스트'}
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors min-h-[44px]"
            >
              {saving ? '저장 중...' : '저장'}
            </button>
          </div>

          {testResult && testResult.success && (
            <div className="text-sm text-green-600">
              <p>연결 성공</p>
              {testResult.meta.teams.length > 0 && (
                <p className="text-muted-foreground">구분: {testResult.meta.teams.join(', ')}</p>
              )}
              {testResult.meta.projects.length > 0 && (
                <p className="text-muted-foreground">
                  프로젝트: {testResult.meta.projects.map((p) => p.name).join(', ')}
                </p>
              )}
            </div>
          )}
          {testResult && !testResult.success && (
            <p className="text-sm text-red-600">연결 실패: {testResult.error}</p>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}
          {success && <p className="text-sm text-green-600">{success}</p>}
        </div>
      )}
    </div>
  )
}
