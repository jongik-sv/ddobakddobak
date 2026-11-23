const STEPS: { title: string; body: string }[] = [
  { title: '마지막 사람 수정 후 대기 시간이 지나면 실행', body: 'AI 원본과 최종본의 diff 를 계산합니다. 차이가 없으면 "변경 없음"으로 끝납니다.' },
  { title: 'LLM 이 diff 에서 "오인식 → 용어" 후보 추출', body: '회의의 "교정 입력" 쌍도 함께 합칩니다. 추출은 회의 생성자의 요약 LLM 설정을 따릅니다.' },
  { title: '오인식 표기가 전사에 있는지 확인', body: '전사에 없으면 제외합니다. 충돌·낮은 확신·사용자 제외로 걸러진 후보는 오인식 기록에 남지만, 형식 부적합·전사에 없음·등록할 레벨 없음으로 걸러진 후보는 오인식 기록에 남지 않고 처리 내역에만 남습니다.' },
  { title: '상위 레벨 확인', body: '회의 폴더 → 상위 폴더 → 프로젝트 → 전역 순으로 같은 용어를 찾습니다.' },
  { title: '등록', body: '상위에 있으면 그 줄에 오인식 표기만 추가합니다(새 줄 없음). 어디에도 없으면 회의의 가장 가까운 폴더(없으면 프로젝트)의 "STT 오인식(자동)" 파일에 새 줄을 만듭니다.' },
  { title: '처리 내역에 기록', body: '쌍별 판정과 등록 위치가 남고, 회의 단위로 되돌릴 수 있습니다.' },
]

export default function FlowGuideView() {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold">자동 등록 순서 (회의 1건)</h3>
      <ol className="space-y-3">
        {STEPS.map((s, i) => (
          <li key={i} className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs text-white">{i + 1}</span>
            <div>
              <div className="text-sm font-medium">{s.title}</div>
              <div className="text-xs text-muted-foreground">{s.body}</div>
            </div>
          </li>
        ))}
      </ol>
      <p className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
        하위 폴더에 같은 용어가 따로 있는 경우는 자동으로 건드리지 않고 레벨별 용어 화면의 "상위로 올릴 후보"로만 알립니다. 사람이 이동 기능으로 합칩니다.
      </p>
    </div>
  )
}
