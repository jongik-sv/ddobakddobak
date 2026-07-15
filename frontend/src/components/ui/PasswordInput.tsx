import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'

/** type을 제외한 input 속성 전부를 실제 input 요소로 전달한다 (id·htmlFor 연결 유지). */
type PasswordInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  /**
   * 토글 버튼 aria-label의 대상 명칭 (예: '현재 비밀번호' → '현재 비밀번호 표시').
   * 같은 폼에 여러 필드가 렌더될 때 스크린리더가 버튼을 구분할 수 있게 한다.
   */
  toggleLabel?: string
}

/** 비밀번호 입력 필드 — 보기/숨기기(눈) 토글 내장. 스타일은 className으로 그대로 전달받는다. */
export function PasswordInput({ className, toggleLabel = '비밀번호', ...rest }: PasswordInputProps) {
  const [visible, setVisible] = useState(false)

  return (
    <div className="relative">
      <input
        {...rest}
        type={visible ? 'text' : 'password'}
        className={`${className ?? ''} pr-10`}
      />
      {/* type="button": form 내부에서 submit 트리거 방지. inset-y-0으로 입력 높이 전체를 덮어 터치 타겟 확보. */}
      {/* onMouseDown preventDefault: 토글 클릭 시 input 포커스 유지 (모바일 키보드 닫힘 방지). */}
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        onMouseDown={(e) => e.preventDefault()}
        aria-label={visible ? `${toggleLabel} 숨기기` : `${toggleLabel} 표시`}
        aria-controls={rest.id}
        className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground transition-colors"
      >
        {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  )
}
