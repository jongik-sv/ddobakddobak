# D'Flow 폴더명 "비교" SSOT — 길이 검사(W4)·team 자동판정(W3) 등 폴더명을 비교·측정하는
# 모든 지점이 이 모듈 하나를 공유한다(사본 금지).
#
# 계약(tasks/dflow-minutes-upload/artifacts/dflow-minutes-upload-api-spec.md) §0 D20·§7 제한 표:
# D'Flow는 폴더명을 btrim + NFC 정규화한 뒤 비교·생성·60자 검증한다. macOS 등에서 만든 한글
# 폴더명은 NFD(자모 분리)로 저장될 수 있어, 원문 그대로 길이를 재거나 비교하면 D'Flow의 실제
# 판정과 어긋난다 — NFD는 같은 글자라도 codepoint 수가 늘어 길이가 부풀거나, 바이트가 달라
# 동등 비교가 실패한다(tasks/dflow-minutes-upload/artifacts/dflow-drift-2026-07-28.md 조치 ①②③).
#
# ⚠️ 저장된 폴더명 자체는 정규화하지 않는다 — 여기서 만든 값은 비교·검사용 파생값일 뿐이다.
# 전송 페이로드(folder_path 원소)도 원문 그대로 보낸다 — 계약이 "또박또박이 NFD로 보내도
# D'Flow에서는 NFC 한 벌로 수렴하므로 같은 이름의 폴더가 둘 생기지 않는다"고 명시하므로(§4.9,
# 스펙 506행) 전송 바이트를 바꿔야 할 이유가 없다.
module DflowFolderName
  MAX_CHARS = 60

  module_function

  # btrim + NFC. 길이 비교·동등 비교는 전부 이 값을 기준으로 한다.
  def normalize(name)
    name.to_s.strip.unicode_normalize(:nfc)
  end

  def too_long?(name)
    normalize(name).length > MAX_CHARS
  end

  # NFC 정규화 후 동등 비교(예: team 자동판정 — root 폴더명 ∈ meta.teams).
  def matches?(a, b)
    normalize(a) == normalize(b)
  end
end
