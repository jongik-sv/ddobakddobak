import { describe, it, expect } from 'vitest'
import {
  detectDflowTeam,
  buildDflowTitle,
  isValidDflowUuid,
  resolveDflowLinkAction,
  dflowRootFolderName,
  dflowSubFolderName,
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

describe('buildDflowTitle', () => {
  it('하위 폴더 있음 → "<하위>-<원제목>"', () => {
    const path = [{ id: 1, name: 'MES' }, { id: 2, name: '물류' }]
    expect(buildDflowTitle(path, '물류공정_260716')).toBe('물류-물류공정_260716')
  })

  it('3단계 이상이어도 바로 아래 폴더명만 사용', () => {
    const path = [
      { id: 1, name: 'MES' },
      { id: 2, name: 'APS' },
      { id: 3, name: '2026.07 1주차 인터뷰' },
    ]
    expect(buildDflowTitle(path, '기획팀 2026.07.09')).toBe('APS-기획팀 2026.07.09')
  })

  it('하위 폴더 없음(루트 직속) → 원제목 그대로', () => {
    const path = [{ id: 1, name: 'MDM' }]
    expect(buildDflowTitle(path, 'MDM 논의 2026.07.15')).toBe('MDM 논의 2026.07.15')
  })

  it('폴더 없음 → 원제목 그대로(trim)', () => {
    expect(buildDflowTitle([], '  제목만 있음  ')).toBe('제목만 있음')
    expect(buildDflowTitle(undefined, '제목')).toBe('제목')
  })

  it('200자 초과 시 하위폴더 접두는 보존하고 원제목 쪽을 잘라 맞춘다', () => {
    const path = [{ id: 1, name: 'MES' }, { id: 2, name: '물류' }]
    const longTitle = 'A'.repeat(300)
    const result = buildDflowTitle(path, longTitle)
    expect(result.length).toBe(200)
    expect(result.startsWith('물류-')).toBe(true)
  })

  it('하위 없이 200자 초과 → 원제목만 200자로 자른다', () => {
    const longTitle = 'B'.repeat(300)
    const result = buildDflowTitle([{ id: 1, name: 'MDM' }], longTitle)
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
