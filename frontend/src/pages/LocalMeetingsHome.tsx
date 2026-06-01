/**
 * LocalMeetingsHome — 게이트 밖(SetupGate/AuthGuard 미적용) 오프라인 회의 홈.
 *
 * 서버를 한 번도 설정/로그인하지 않은 상태에서도 진입 가능한 완전 오프라인 진입점.
 * LocalMeetingsSection(생성 버튼 + 기기저장 버킷)을 그대로 재사용한다.
 * /local-meetings 라우트. SetupGate 화면에서 "오프라인으로 시작"으로 진입.
 */
import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

import { LocalMeetingsSection } from '../components/meeting/LocalMeetingsSection'
import ModelManager from '../components/stt/ModelManager'

export default function LocalMeetingsHome() {
  const navigate = useNavigate()
  return (
    <div className="min-h-screen bg-background p-4">
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={() => navigate('/meetings')}
          className="p-2 -ml-2 rounded-md hover:bg-accent"
          aria-label="서버 모드로"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-bold">오프라인 회의</h1>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        서버 연결 없이 폰에서 녹음·전사하는 회의입니다. 기록은 기기에 저장되며, 나중에
        서버에 연결되면 업로드해 공유·검색·요약을 쓸 수 있습니다.
      </p>
      {/* 오프라인 전사에 필요한 온디바이스 모델 다운로드·관리(이 화면에서 직접 받게) */}
      <ModelManager className="mb-4" />
      <LocalMeetingsSection />
    </div>
  )
}
