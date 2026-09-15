# 교정 엔트리 배열을 텍스트에 순차 적용한다.
# entry = { from:, to:, match_type: "literal"|"regex" }
# regex 는 사용자 입력 → 백그라운드 잡에서 무인 실행되므로 ReDoS 가드 필수:
#   per-pattern Regexp.timeout + 적용 중 타임아웃/컴파일 오류 시 해당 엔트리만 스킵.
class GlossaryApplication
  REGEX_TIMEOUT = 0.5 # seconds

  # 인용 마커(⟦...⟧) 보호 대상 범위.
  # 정본 형식(LlmPrompts::CitationMarkers::CITATION_RE / FOLDER_CITATION_RE)만 보호하면
  # 충분해 보이지만, 이미 다른 경로(LLM 출력이 정본 형식을 변형해 냄, 혹은 과거에 이미
  # 오타 사전에 한 번 뜯긴 마커)로 깨져 있는 마커가 이번 교정에서 한 번 더 훼손되는 것까지는
  # 막지 못한다. citation_markers.rb 의 drop_unrepairable_closed_fragments/strip_all 도
  # "⟦...⟧ 로 닫힌 것은 전부 마커스러운 것으로 취급"하는 동일하게 넓은 범위(⟦[^⟧\n]*⟧)를
  # 이미 정본 관례로 쓰고 있으므로 그 관례를 그대로 따른다. ⟦⟧(U+27E6/U+27E7, 수학용 흰
  # 대괄호)는 일반 회의록 본문에 등장할 일이 사실상 없어, 범위를 넓혀도 "마커가 아닌 진짜
  # 본문을 마커로 오인해 오타 교정을 건너뛰는" 오탐 위험은 거의 없다. 줄바꿈을 배제한 것도
  # citation_markers.rb 와 동일한 이유 — 마커가 여러 줄에 걸쳐 있다면 그건 이미 마커가 아니라
  # 우연히 등장한 본문 기호일 가능성이 높다.
  MARKER_RE = /⟦[^⟧\n]*⟧/

  # 자리표시자는 처음부터 끝까지 유니코드 사용자 영역(PUA, U+E000대) 코드포인트로만
  # 구성한다. \u 이스케이프로 명시한다(소스에 원시 PUA 문자를 그대로 박아두면 에디터·
  # 터미널마다 렌더링이 달라 다루기 어렵다).
  #
  # - 제어문자(0x00-0x1F, 특히 NUL(\u0000))를 델리미터로 쓰지 않은 이유: NUL은 SQLite/
  #   Postgres 드라이버에 따라 문자열을 조기 절단시키거나 저장 자체를 거부할 수 있어
  #   위험하고, 그 외 C0 제어문자도 로그·직렬화(JSON 등) 경로에서 이스케이프·소실될 여지가
  #   있다. PUA는 완전히 유효한 UTF-8 문자이면서 SQLite/Postgres 어디서도 특별 취급되지
  #   않는다.
  # - PUA는 일반 키보드·IME로 입력되지 않으므로 오타 사전 from 값(사용자 입력)에 우연히
  #   등장할 확률이 사실상 0이다. 설령 원문에 이미 PUA 문자가 들어 있었다 해도(그런 텍스트가
  #   존재한다는 뜻), 자리표시자는 "PUA 델리미터 + 이번 호출에서만 존재하는 무작위 토큰 +
  #   마커 인덱스"의 조합이라 원문에 우연히 있던 PUA 문자와 정확히 일치할 수 없고, 사전
  #   엔트리가 "이번 호출의 정확한 토큰"을 미리 알고 매치하도록 작성될 수도 없다(사전은
  #   텍스트가 저장되는 시점과 무관하게 미리 존재하고, 토큰은 이 메서드 실행 시점에만
  #   생성된다).
  # - 자리표시자 몸통(토큰·인덱스)도 hex/ASCII 표기가 아니라 PUA 코드포인트로만 인코딩한다
  #   (#encode_nibbles). 처음 구현은 "GLM:<hex토큰>:<인덱스>" 처럼 일반 ASCII로 조립했는데,
  #   그러면 숫자를 대상으로 하는 오타 사전 항목(바로 이번 실서버 사고의 원인이 된 부류,
  #   예: {from: "1", to: "일"})이 토큰의 우연한 숫자·문자 나열이나 인덱스 숫자 자체를
  #   매치해 자리표시자를 훼손하는 것을 회귀 테스트로 실제로 재현했다. 자리표시자를 끝까지
  #   PUA 코드포인트로만 구성하면 오타 사전이 매치할 수 있는 어떤 현실적 문자 클래스(숫자·
  #   영문·한글 등)와도 겹치지 않아 이 경로의 자기 훼손이 원천적으로 없어진다(단, `.` 나
  #   `\p{Any}` 처럼 문자 종류를 가리지 않는 와일드카드 정규식까지는 막지 못한다 — 그런
  #   극단적 사전 항목에 대해서는 여전히 "훼손 감지 후 해당 마커만 유실, 로그"로 방어한다).
  PLACEHOLDER_OPEN = "\uE000"
  PLACEHOLDER_CLOSE = "\uE001"
  NIBBLE_SEPARATOR = "\uE00F"
  NIBBLE_BASE = 0xE010 # 0xE010..0xE01F 16개 코드포인트 = hex 니블(0-f) 1개당 1문자

  def self.apply(text, entries)
    return text if text.blank? || entries.blank?
    entries.reduce(text) { |acc, e| apply_one(acc, e) }
  end

  # 인용 마커를 자리표시자로 바꿔 보호한 뒤 오타 교정(#apply)을 적용하고, 끝나면 자리표시자를
  # 원문 마커 바이트 그대로 복원한다. 요약 4컬럼·blocks.content 처럼 인용 마커가 실제로 담겨
  # 있는 표면 전용이다 — 전사 원문에는 마커가 없고(마커는 요약 생성 시점에 LLM이 붙이는 것)
  # 전사 자체가 교정 대상이므로, 전사 경로는 이 메서드를 쓰지 않고 기존 #apply(비보호)를
  # 그대로 둔다.
  def self.apply_protecting_markers(text, entries)
    return text if text.blank? || entries.blank?

    markers = []

    # 자리표시자에 순번(idx)을 내장해 콘텐츠 주소 방식으로 복원한다. 그래서 특정 자리표시자
    # 하나가 교정 정규식에 먹혀 훼손되더라도(#apply 는 임의 정규식을 실행하므로 원론적으로
    # 가능) 그 훼손이 다른 자리표시자의 복원 순서를 밀거나 뒤섞지 않는다 — 훼손된 자리
    # 표시자만 매치 실패로 로그를 남기고 그 마커는 복원되지 않은 채 남고(마커 하나만 유실 —
    # 보호를 아예 안 걸었을 때와 같은 최악의 경우로 그침), 나머지는 정상 복원된다.
    token = SecureRandom.hex(16)

    protected_text = text.gsub(MARKER_RE) do |whole|
      idx = markers.length
      markers << whole
      placeholder(token, idx)
    end

    corrected = apply(protected_text, entries)

    markers.each_with_index do |original, idx|
      ph = placeholder(token, idx)
      if corrected.include?(ph)
        corrected = corrected.gsub(ph) { original }
      else
        Rails.logger.warn("[glossary] marker placeholder lost idx=#{idx} token=#{token}")
      end
    end

    corrected
  end

  def self.placeholder(token, idx)
    "#{PLACEHOLDER_OPEN}#{encode_nibbles(token)}#{NIBBLE_SEPARATOR}#{encode_nibbles(idx.to_s(16))}#{PLACEHOLDER_CLOSE}"
  end
  private_class_method :placeholder

  # hex 문자열(0-9a-f)의 각 니블을 PUA 코드포인트 1개로 재매핑한다. 위 상수 주석 참고 —
  # 자리표시자에 일반 ASCII 숫자/문자를 전혀 남기지 않기 위함이다.
  def self.encode_nibbles(hex_str)
    hex_str.each_char.map { |c| [NIBBLE_BASE + c.to_i(16)].pack("U") }.join
  end
  private_class_method :encode_nibbles

  def self.apply_one(text, entry)
    if entry[:match_type] == "regex"
      re = Regexp.new(entry[:from].to_s, timeout: REGEX_TIMEOUT)
      text.gsub(re, entry[:to].to_s)
    else
      text.gsub(entry[:from].to_s) { entry[:to].to_s }
    end
  rescue Regexp::TimeoutError, RegexpError => err
    Rails.logger.warn("[glossary] regex skip from=#{entry[:from].inspect} err=#{err.class}")
    text
  end
end
