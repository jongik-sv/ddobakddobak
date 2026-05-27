import { useNavigate } from 'react-router-dom'

interface MeetingAccessFallbackProps {
  error: 'forbidden' | 'not_found'
}

export function MeetingAccessFallback({ error }: MeetingAccessFallbackProps) {
  const navigate = useNavigate()
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 p-6 text-center">
      <p className="text-sm text-gray-600">
        {error === 'forbidden'
          ? '이 회의에 접근 권한이 없습니다. 공유 코드로 참여하세요.'
          : '회의를 찾을 수 없습니다.'}
      </p>
      <button
        onClick={() => navigate('/meetings')}
        className="px-4 py-2 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700"
      >
        회의 목록으로
      </button>
    </div>
  )
}
