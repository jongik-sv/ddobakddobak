import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TranscribingProgress } from './TranscribingProgress'

// 파일 전사 대기열 위치 표시: queuePosition >= 1이면 진행률 바 대신 "앞에 N건 대기 중"을
// 보여주고, 실행이 시작되면(queuePosition null) 기존 진행률 표시로 전환된다.
describe('TranscribingProgress', () => {
  it('queuePosition이 1 이상이면 대기 안내를 보여주고 진행률 바는 숨긴다', () => {
    render(
      <TranscribingProgress
        title="회의"
        progressPercent={0}
        message="오디오 파일 처리 준비 중..."
        isError={false}
        queuePosition={3}
      />
    )

    expect(screen.getByText('앞에 3건 대기 중')).toBeInTheDocument()
    expect(screen.queryByText('오디오 파일 처리 준비 중...')).not.toBeInTheDocument()
    expect(screen.queryByText('0%')).not.toBeInTheDocument()
  })

  it('queuePosition이 null이면 기존 진행률 표시로 전환된다', () => {
    render(
      <TranscribingProgress
        title="회의"
        progressPercent={42}
        message="음성 인식 중..."
        isError={false}
        queuePosition={null}
      />
    )

    expect(screen.getByText('음성 인식 중...')).toBeInTheDocument()
    expect(screen.getByText('42%')).toBeInTheDocument()
    expect(screen.queryByText(/건 대기 중/)).not.toBeInTheDocument()
  })

  it('queuePosition 미전달(undefined)이어도 기존 진행률 표시(하위호환)', () => {
    render(
      <TranscribingProgress
        title="회의"
        progressPercent={10}
        message="음성 인식 중..."
        isError={false}
      />
    )

    expect(screen.getByText('음성 인식 중...')).toBeInTheDocument()
    expect(screen.getByText('10%')).toBeInTheDocument()
  })

  it('queuePosition이 아직 stale하게 양수여도 progressPercent>0(브로드캐스트 수신)이면 진행률 표시로 즉시 전환된다', () => {
    render(
      <TranscribingProgress
        title="회의"
        progressPercent={15}
        message="음성 인식 중..."
        isError={false}
        queuePosition={1}
      />
    )

    expect(screen.queryByText(/건 대기 중/)).not.toBeInTheDocument()
    expect(screen.getByText('음성 인식 중...')).toBeInTheDocument()
    expect(screen.getByText('15%')).toBeInTheDocument()
  })

  it('에러 상태면 queuePosition이 있어도 대기 안내 대신 진행률/에러를 보여준다', () => {
    render(
      <TranscribingProgress
        title="회의"
        progressPercent={20}
        message="음성 인식 중..."
        isError={true}
        error="변환 실패"
        queuePosition={2}
      />
    )

    expect(screen.queryByText('앞에 2건 대기 중')).not.toBeInTheDocument()
    expect(screen.getByText(/오류: 변환 실패/)).toBeInTheDocument()
  })
})
