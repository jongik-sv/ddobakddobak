// 회의 상세 헤더의 액션 버튼들이 동일한 높이·모양(컴팩트 ~30px 알약)을 공유하도록 하는 클래스.
// 변형은 색만 바꾼다(중립=회색, 강조=앰버/블루, 위험=빨강).
export const ACTION_BTN_BASE =
  'inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
export const ACTION_NEUTRAL = `${ACTION_BTN_BASE} bg-gray-100 text-gray-700 hover:bg-gray-200`
export const ACTION_AMBER = `${ACTION_BTN_BASE} bg-amber-500 text-white hover:bg-amber-600`
export const ACTION_BLUE = `${ACTION_BTN_BASE} bg-blue-600 text-white hover:bg-blue-700`
export const ACTION_DANGER = `${ACTION_BTN_BASE} bg-red-50 text-red-600 hover:bg-red-100`
