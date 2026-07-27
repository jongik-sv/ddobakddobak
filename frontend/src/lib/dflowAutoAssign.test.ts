import { describe, it, expect } from 'vitest'
import {
  detectDflowTeam,
  buildDflowTitle,
  buildDflowLegacyPrefixedTitle,
  isValidDflowUuid,
  resolveDflowLinkAction,
  dflowRootFolderName,
  dflowSubFolderName,
  dflowEffectiveFolderDepth,
  dflowFolderDepthExceedsWarningLimit,
  dflowFolderPreviewPath,
} from './dflowAutoAssign'

const teams = ['MES', 'MDM', 'PMO', 'ERP', '가공']

describe('dflowRootFolderName / dflowSubFolderName', () => {
  it('폴더 없음 → 둘 다 undefined', () => {
    expect(dflowRootFolderName(undefined)).toBeUndefined()
    expect(dflowRootFolderName([])).toBeUndefined()
    expect(dflowSubFolderName([])).toBeUndefined()
  })

  it('1단계(루트 직속) → root만 있고 sub 없음', () => {
    const path = [{ id: 1, name: 'MDM' }]
    expect(dflowRootFolderName(path)).toBe('MDM')
    expect(dflowSubFolderName(path)).toBeUndefined()
  })

  it('2단계 → root=최상위, sub=바로 아래', () => {
    const path = [{ id: 1, name: 'MES' }, { id: 2, name: '물류' }]
    expect(dflowRootFolderName(path)).toBe('MES')
    expect(dflowSubFolderName(path)).toBe('물류')
  })

  it('3단계 이상 → sub는 여전히 최상위 바로 아래(그 아래는 무시)', () => {
    const path = [
      { id: 1, name: 'MES' },
      { id: 2, name: 'APS' },
      { id: 3, name: '2026.07 1주차 인터뷰' },
    ]
    expect(dflowRootFolderName(path)).toBe('MES')
    expect(dflowSubFolderName(path)).toBe('APS')
  })
})

describe('detectDflowTeam', () => {
  it('최상위 폴더명이 meta.teams와 일치 → 그 team 반환', () => {
    const path = [{ id: 1, name: 'MES' }, { id: 2, name: '물류' }]
    expect(detectDflowTeam(path, teams)).toBe('MES')
  })

  it('최상위 폴더명이 meta.teams와 불일치 → null', () => {
    const path = [{ id: 1, name: '임원 인터뷰' }]
    expect(detectDflowTeam(path, teams)).toBeNull()
  })

  it('폴더 없음 → null', () => {
    expect(detectDflowTeam([], teams)).toBeNull()
    expect(detectDflowTeam(undefined, teams)).toBeNull()
  })
})

// §2-C: 실효 깊이 = folder_path.length + (루트가 이번 전송의 team과 같으면 0, 다르면 1).
// D'Flow는 5 초과를 조용히 절단한다(400 아님) — 여기서는 차단 없이 "경고를 띄워야 하는가"만
// 판정한다(브리프 3-b). resolvedTeam은 "이번 전송에서 실제로 보낼 team"이지 meta.teams
// 소속 여부가 아니다 — §2-C가 "teamOverride 확정 이후 재평가"를 요구하는 이유(아래 별도 케이스).
describe('dflowEffectiveFolderDepth / dflowFolderDepthExceedsWarningLimit', () => {
  it('루트 == 이번 전송 team(+0) → 5단이면 경계까지는 경고 없음', () => {
    const path = [
      { id: 1, name: 'MES' },
      { id: 2, name: 'A' },
      { id: 3, name: 'B' },
      { id: 4, name: 'C' },
      { id: 5, name: 'D' },
    ]
    expect(dflowEffectiveFolderDepth(path, 'MES')).toBe(5)
    expect(dflowFolderDepthExceedsWarningLimit(path, 'MES')).toBe(false)
  })

  it('루트 == 이번 전송 team(+0) → 6단이면 경고', () => {
    const path = [
      { id: 1, name: 'MES' },
      { id: 2, name: 'A' },
      { id: 3, name: 'B' },
      { id: 4, name: 'C' },
      { id: 5, name: 'D' },
      { id: 6, name: 'E' },
    ]
    expect(dflowEffectiveFolderDepth(path, 'MES')).toBe(6)
    expect(dflowFolderDepthExceedsWarningLimit(path, 'MES')).toBe(true)
  })

  it('자유 루트(이번 전송 team과 다름, +1) → 4단만 되어도 실효 5단이라 경계까지는 경고 없음', () => {
    const path = [
      { id: 1, name: '임원 인터뷰' },
      { id: 2, name: 'A' },
      { id: 3, name: 'B' },
      { id: 4, name: 'C' },
    ]
    expect(dflowEffectiveFolderDepth(path, 'PMO')).toBe(5)
    expect(dflowFolderDepthExceedsWarningLimit(path, 'PMO')).toBe(false)
  })

  it('자유 루트(+1) → 5단이면 실효 6단이라 경고', () => {
    const path = [
      { id: 1, name: '임원 인터뷰' },
      { id: 2, name: 'A' },
      { id: 3, name: 'B' },
      { id: 4, name: 'C' },
      { id: 5, name: 'D' },
    ]
    expect(dflowEffectiveFolderDepth(path, 'PMO')).toBe(6)
    expect(dflowFolderDepthExceedsWarningLimit(path, 'PMO')).toBe(true)
  })

  it('폴더 없음 → 팀 루트로 되돌아가므로 실효 깊이 1(0+1), 경고 없음', () => {
    expect(dflowEffectiveFolderDepth(undefined, 'MES')).toBe(1)
    expect(dflowFolderDepthExceedsWarningLimit([], 'MES')).toBe(false)
  })

  it('team 미확정(null) → 보수적으로 +1 처리한다(select 노출 중, 아직 값 없음)', () => {
    const path = [{ id: 1, name: 'MES' }]
    expect(dflowEffectiveFolderDepth(path, null)).toBe(2)
  })

  // 정본 §2-C "경고는 teamOverride 확정 이후 재평가": 루트 이름이 meta.teams에 있는 team이어도,
  // team_required 재시도 등으로 이번 전송이 **다른** team으로 확정되면 D'Flow는 root를 팀 루트로
  // 보지 않는다 — root가 어떤 team의 이름과도 무관하게 "이번에 실제로 보낼 team"만 비교 대상이다.
  it('루트가 team 코드 모양이어도 이번 전송 team과 다르면 +1이 붙는다(팀 재선택 시나리오)', () => {
    const path = [
      { id: 1, name: 'MES' },
      { id: 2, name: 'A' },
      { id: 3, name: 'B' },
      { id: 4, name: 'C' },
      { id: 5, name: 'D' },
    ]
    // 최초 자동판정대로면(team=MES) 5단 경계 — 경고 없음.
    expect(dflowFolderDepthExceedsWarningLimit(path, 'MES')).toBe(false)
    // 그러나 사용자가(혹은 team_required 재시도로) 다른 team(PMO)을 선택해 전송하면 6단 실효 → 경고.
    expect(dflowEffectiveFolderDepth(path, 'PMO')).toBe(6)
    expect(dflowFolderDepthExceedsWarningLimit(path, 'PMO')).toBe(true)
  })
})

// W7: 미리보기 경로 조립. 판정 기준(root === 이번 전송 team)은 dflowEffectiveFolderDepth와
// dflowRootIsResolvedTeamRoot 하나를 공유한다 — 사본이면 경고와 미리보기가 서로 다른 말을 한다.
describe('dflowFolderPreviewPath', () => {
  it('루트 == 이번 전송 team → team 접두 없이 경로 그대로', () => {
    const path = [{ id: 1, name: 'MES' }, { id: 2, name: '품질' }, { id: 3, name: '주간정례' }]
    expect(dflowFolderPreviewPath(path, 'MES')).toEqual(['MES', '품질', '주간정례'])
  })

  it('루트 != 이번 전송 team(자유 루트) → team이 맨 앞에 한 칸 끼어든다(정규화 ②)', () => {
    const path = [{ id: 1, name: '신규TF' }, { id: 2, name: '킥오프' }]
    expect(dflowFolderPreviewPath(path, 'MES')).toEqual(['MES', '신규TF', '킥오프'])
  })

  it('team 미확정(null) → team을 붙이지 않는다(아직 판정 불가)', () => {
    const path = [{ id: 1, name: '신규TF' }, { id: 2, name: '킥오프' }]
    expect(dflowFolderPreviewPath(path, null)).toEqual(['신규TF', '킥오프'])
  })

  it('폴더 없음 + team 확정 → team 하나만', () => {
    expect(dflowFolderPreviewPath(undefined, 'MES')).toEqual(['MES'])
    expect(dflowFolderPreviewPath([], 'MES')).toEqual(['MES'])
  })

  it('폴더 없음 + team 미확정 → 빈 배열', () => {
    expect(dflowFolderPreviewPath(undefined, null)).toEqual([])
  })

  it('team_required 재시도로 root와 다른 team을 선택하면 그 team이 앞에 붙는다(팀 재선택 시나리오)', () => {
    const path = [{ id: 1, name: 'MES' }, { id: 2, name: 'A' }]
    // 자동판정대로면(team=MES) 접두 없음.
    expect(dflowFolderPreviewPath(path, 'MES')).toEqual(['MES', 'A'])
    // 사용자가 다른 team(PMO)을 선택해 전송하면 PMO가 한 칸 끼어든다.
    expect(dflowFolderPreviewPath(path, 'PMO')).toEqual(['PMO', 'MES', 'A'])
  })

  // 판정 공유 확인: 사본이면 갈릴 수 있는 지점 — 세그먼트 개수가 실효 깊이와 항상 일치해야 한다.
  it('배열 길이가 dflowEffectiveFolderDepth와 일치한다(판정 공유 확인)', () => {
    const path = [
      { id: 1, name: 'MES' },
      { id: 2, name: 'A' },
      { id: 3, name: 'B' },
      { id: 4, name: 'C' },
      { id: 5, name: 'D' },
    ]
    expect(dflowFolderPreviewPath(path, 'MES').length).toBe(dflowEffectiveFolderDepth(path, 'MES'))
    expect(dflowFolderPreviewPath(path, 'PMO').length).toBe(dflowEffectiveFolderDepth(path, 'PMO'))
  })
})

describe('buildDflowTitle', () => {
  it('폴더 유무와 무관하게 접두 없이 원제목 그대로(trim)', () => {
    expect(buildDflowTitle('물류공정_260716')).toBe('물류공정_260716')
    expect(buildDflowTitle('  제목만 있음  ')).toBe('제목만 있음')
  })

  it('200자 초과 시 접두 없이 원제목만 200자로 자른다', () => {
    const longTitle = 'B'.repeat(300)
    const result = buildDflowTitle(longTitle)
    expect(result.length).toBe(200)
    expect(result).toBe('B'.repeat(200))
  })

  // 패리티: 다이얼로그 미리보기(buildDflowTitle)가 실제 전송값(백엔드 dflow_auto_title)과
  // 문자 단위로 같아야 한다. 카운터파트: backend/spec/models/meeting_spec.rb
  // describe('#dflow_auto_title') 의 동명 패리티 케이스 — 리터럴을 양쪽에서 동시에 바꿔야 한다.
  it('패리티: 물류공정_260716 → 백엔드 dflow_auto_title과 동일 문자열', () => {
    expect(buildDflowTitle('물류공정_260716')).toBe('물류공정_260716')
  })

  it('패리티: 200자 경계에서도 백엔드 dflow_auto_title과 동일 문자열', () => {
    const longTitle = '가'.repeat(250)
    const result = buildDflowTitle(longTitle)
    expect(result.length).toBe(200)
    expect(result).toBe('가'.repeat(200))
  })
})

describe('buildDflowLegacyPrefixedTitle', () => {
  it('하위 폴더 있음 → "<하위>-<원제목>"', () => {
    const path = [{ id: 1, name: 'MES' }, { id: 2, name: '물류' }]
    expect(buildDflowLegacyPrefixedTitle(path, '물류공정_260716')).toBe('물류-물류공정_260716')
  })

  it('3단계 이상이어도 바로 아래 폴더명만 사용', () => {
    const path = [
      { id: 1, name: 'MES' },
      { id: 2, name: 'APS' },
      { id: 3, name: '2026.07 1주차 인터뷰' },
    ]
    expect(buildDflowLegacyPrefixedTitle(path, '기획팀 2026.07.09')).toBe('APS-기획팀 2026.07.09')
  })

  it('하위 폴더 없음(루트 직속) → 원제목 그대로', () => {
    const path = [{ id: 1, name: 'MDM' }]
    expect(buildDflowLegacyPrefixedTitle(path, 'MDM 논의 2026.07.15')).toBe('MDM 논의 2026.07.15')
  })

  it('폴더 없음 → 원제목 그대로(trim)', () => {
    expect(buildDflowLegacyPrefixedTitle([], '  제목만 있음  ')).toBe('제목만 있음')
    expect(buildDflowLegacyPrefixedTitle(undefined, '제목')).toBe('제목')
  })

  it('200자 초과 시 하위폴더 접두는 보존하고 원제목 쪽을 잘라 맞춘다', () => {
    const path = [{ id: 1, name: 'MES' }, { id: 2, name: '물류' }]
    const longTitle = 'A'.repeat(300)
    const result = buildDflowLegacyPrefixedTitle(path, longTitle)
    expect(result.length).toBe(200)
    expect(result.startsWith('물류-')).toBe(true)
  })

  it('하위 없이 200자 초과 → 원제목만 200자로 자른다', () => {
    const longTitle = 'B'.repeat(300)
    const result = buildDflowLegacyPrefixedTitle([{ id: 1, name: 'MDM' }], longTitle)
    expect(result.length).toBe(200)
    expect(result).toBe('B'.repeat(200))
  })
})

describe('isValidDflowUuid', () => {
  it('올바른 UUID 형식 → true', () => {
    expect(isValidDflowUuid('01911f3e-7a3b-7000-8000-abcdefabcdef')).toBe(true)
    expect(isValidDflowUuid('01911F3E-7A3B-7000-8000-ABCDEFABCDEF')).toBe(true)
  })

  it('형식이 다르면 → false', () => {
    expect(isValidDflowUuid('not-a-uuid')).toBe(false)
    expect(isValidDflowUuid('01911f3e-7a3b-7000-8000-abcdefabcde')).toBe(false) // 1자 부족
    expect(isValidDflowUuid('')).toBe(false)
  })
})

describe('resolveDflowLinkAction', () => {
  it('ddobak: 프리픽스 → link(A), uuid 부분만 추출', () => {
    expect(resolveDflowLinkAction('ddobak:01911f3e-7a3b-7000-8000-abcdefabcdef')).toEqual({
      type: 'link',
      publicUid: '01911f3e-7a3b-7000-8000-abcdefabcdef',
    })
  })

  it('external_id null → claim(B)', () => {
    expect(resolveDflowLinkAction(null)).toEqual({ type: 'claim' })
  })

  it('다른 프리픽스/형식이면 → claim(B)으로 폴백(서버가 최종 판정)', () => {
    expect(resolveDflowLinkAction('other-system:abc123')).toEqual({ type: 'claim' })
    expect(resolveDflowLinkAction('')).toEqual({ type: 'claim' })
  })
})
