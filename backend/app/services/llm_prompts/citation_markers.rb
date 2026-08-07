module LlmPrompts
  # 인용 마커 ⟦t:<ms>[|/]s:<화자>⟧ / ⟦m:<회의id>/t:<ms>[|/]s:<화자>⟧ 의 Ruby 단일 소스.
  # 프론트 frontend/src/lib/citationMarkers.ts 의 CITATION_RE(:3) / FOLDER_CITATION_RE(:6) /
  # markerTimeToMs(:9-15) 와 1:1로 대응한다.
  #
  # 절단(transcripts#redact)은 마커를 "쓰기" 때문에 단일 소스가 필수다. 기존 하드코딩 4곳은
  # 표현식이 제각각이고 그중 둘은 폴더 스코프 m: 형태를 아예 못 다룬다 — 통일은 별도 후속이며
  # 여기서는 대조만 해둔다:
  #   app/models/summary.rb:14                /⟦t:\d+(?::\d+)*[|\/]s:[^⟧]+⟧/  콜론 O, m: X
  #   app/models/meeting.rb:620               /⟦[^⟧]*⟧/                        전 마커 통삭제
  #   app/services/markdown_exporter.rb:43    /[ \t]*⟦t:\d+[|\/]s:[^⟧]+⟧/      콜론 X, m: X
  #   app/services/meeting_chat_context.rb:50 /⟦t:\d+[|\/]s:[^⟧]+⟧/            콜론 X, m: X
  module CitationMarkers
    # 회의 스코프 마커. 캡처: 1=시간문자열(ms 또는 mm:ss/hh:mm:ss), 2=화자.
    CITATION_RE = /⟦t:(\d+(?::\d+)*)[|\/]s:([^⟧]+)⟧/
    # 폴더·프로젝트 스코프 마커. 캡처: 1=회의id, 2=시간문자열, 3=화자.
    # m: 와 t: 사이 구분자는 프론트와 동일하게 '/' 고정이고, s: 앞만 [|/] 둘 다 허용된다.
    FOLDER_CITATION_RE = /⟦m:(\d+)\/t:(\d+(?::\d+)*)[|\/]s:([^⟧]+)⟧/

    module_function

    # 마커 시각값 → ms. ':' 있으면 mm:ss 또는 hh:mm:ss, 없으면 이미 ms.
    def marker_time_to_ms(raw)
      return raw.to_i unless raw.include?(":")

      raw.split(":").map(&:to_i).reduce(0) { |acc, n| acc * 60 + n } * 1000
    end

    # ms → 마커 시각 문자열. `like`(원본 문자열)와 같은 형태로 재직렬화한다.
    # 콜론 형태에는 소수 필드가 없으므로 초 미만은 버린다(경계 클램프의 정수 나눗셈 때문에
    # 시프트 결과가 초 단위로 떨어지지 않을 수 있다).
    def format_marker_time(ms, like:)
      return ms.to_s unless like.include?(":")

      total = ms / 1000
      if like.count(":") >= 2
        format("%d:%02d:%02d", total / 3600, (total % 3600) / 60, total % 60)
      else
        format("%d:%02d", total / 60, total % 60)
      end
    end

    # CITATION_RE/FOLDER_CITATION_RE의 완결(anchored) 버전 — 정규화 후 마커가 정본 형식과
    # 완전히 일치하는지 검사하는 데만 쓴다(원본은 검색용이라 앞뒤 문맥을 허용).
    CITATION_FULL_RE = /\A#{CITATION_RE.source}\z/
    FOLDER_CITATION_FULL_RE = /\A#{FOLDER_CITATION_RE.source}\z/

    # ── 인용 마커 정규화 ──
    #
    # LLM 출력이 정본 마커 형식을 자주 변형한다(ms 단위 붙임, 구분자·`s:` 소실, 시간 범위
    # 표현으로 `~` GFM 취소선 오염 등). 프론트 정규식(CITATION_RE/FOLDER_CITATION_RE와 1:1
    # 대응하는 frontend/src/lib/citationMarkers.ts) 매칭이 깨지면 마커가 원문 그대로 노출된다.
    #
    # 교정 순서(각 단계는 다음 단계의 전제를 만든다 — 순서를 바꾸면 깨짐):
    #   1) 마커 사이 범위(⟧~⟦)의 '~'를 공백으로 (양쪽 마커는 그대로 보존)
    #   2) 마커 내부 범위(t:A~B)를 시작값만 남기고 축약 (끝값·단위 폐기)
    #   3) 시간부 단위 접미사(ms/s) 제거 — t: 숫자(콜론 시간 포함) 직후에 붙은 것만
    #   4) 구분자 소실 케이스: bare colon(t:100:화자) → |s: 복원
    #   5) 구분자는 있으나 's:' 라벨만 소실(t:100|화자) → 's:' 삽입
    #   6) 위 교정으로도 정본 형식과 여전히 불일치하는 완결(⟦...⟧) 마커스러운 조각 삭제(+로깅)
    #   7) 닫힘 ⟧ 없이 잘린 마커스러운 조각 삭제(+로깅)
    #
    # 정상 마커는 어느 단계에도 매치되지 않아 바이트 그대로 보존된다. nil/blank 안전,
    # normalize(normalize(x)) == normalize(x) (멱등 — 6·7단계 삭제 후 잔재가 없어 재실행해도
    # 추가 변경이 없다).
    def normalize(text)
      return text if text.to_s.strip.empty?

      result = text
      result = collapse_marker_to_marker_range(result)
      result = collapse_in_marker_range(result)
      result = strip_time_unit(result)
      result = repair_bare_colon_separator(result)
      result = repair_missing_speaker_label(result)
      result = drop_unrepairable_closed_fragments(result)
      drop_unclosed_fragments(result)
    end

    # ⟧~⟦ / ⟧ ~ ⟦ (마커 사이 시간 범위 표현, md 취소선 오염 원인) → '~'만 공백으로.
    def collapse_marker_to_marker_range(text)
      text.gsub(/⟧\s*~\s*⟦/, "⟧ ⟦")
    end

    # 마커 내부 범위 t:A~B (양쪽 단위 접미사 허용) → 시작값만. '|' 또는 '/'(s: 로 향하는
    # 구분자) 직전까지만 매치해 마커 구조 밖의 일반 '~' 텍스트(예: "2~3시")는 건드리지 않는다.
    def collapse_in_marker_range(text)
      text.gsub(/t:(\d+(?::\d+)*)(?:ms|s)?~\d+(?::\d+)*(?:ms|s)?(?=[|\/])/) { "t:#{$1}" }
    end

    # 시간부 단위 접미사(ms/s) 제거. t: 숫자 직후 구분자·⟧ 앞에 붙은 것만 대상 —
    # 화자명 문자열은 lookahead 문자셋에 없어 절대 매치되지 않는다.
    def strip_time_unit(text)
      text.gsub(/t:(\d+(?::\d+)*)(?:ms|s)(?=[:|\/⟧])/) { "t:#{$1}" }
    end

    # bare colon 구분자 소실: t:<시간>:<화자>⟧ → t:<시간>|s:<화자>⟧
    # 콜론 시간(mm:ss)은 (?::\d+)* 가 이미 전부 흡수하므로, 여기 남는 콜론은 항상
    # "구분자가 소실된 broken 콜론"이지 정상 콜론 시간의 일부가 아니다.
    def repair_bare_colon_separator(text)
      text.gsub(/t:(\d+(?::\d+)*):([^⟧|\/]+)⟧/) { "t:#{$1}|s:#{$2}⟧" }
    end

    # 구분자(|또는/)는 있으나 's:' 라벨이 소실: t:<시간>|<화자>⟧ → t:<시간>|s:<화자>⟧
    # 이미 's:'가 있으면 negative lookahead로 건너뛴다(정상 마커 무변형).
    def repair_missing_speaker_label(text)
      text.gsub(/t:(\d+(?::\d+)*)([|\/])(?!s:)([^⟧]+)⟧/) { "t:#{$1}#{$2}s:#{$3}⟧" }
    end

    # 닫힘(⟧)은 있으나 위 교정을 거치고도 정본 형식과 불일치하는 마커스러운(m:/t: 로 시작)
    # 조각 삭제. 그 외 본문 '⟦'(마커와 무관한 일반 텍스트)는 보존.
    def drop_unrepairable_closed_fragments(text)
      text.gsub(/⟦([^⟧\n]*)⟧/) do |whole|
        body = $1
        if whole.match?(CITATION_FULL_RE) || whole.match?(FOLDER_CITATION_FULL_RE)
          whole
        elsif body.match?(/\A(?:m:|t:)/)
          log_unrepairable(whole)
          ""
        else
          whole
        end
      end
    end

    # 닫힘 ⟧ 없이 잘린 마커스러운 조각 삭제(복구 불가). ⟦ 뒤가 m:/t: 로 시작하고 숫자·콜론·
    # 구분자·단위 문자(m/t/s, 0-9, :, /, |)로만 이어지다 공백 또는 문자열 끝에 닿으면 대상.
    # 정상 마커는 s: 뒤 화자명(한글 등)이 이 문자셋 밖이라 lookahead가 실패해 매치되지 않는다.
    def drop_unclosed_fragments(text)
      text.gsub(/⟦(?:m:|t:)[mts0-9:\/|]*(?=\s|\z)/) do |whole|
        log_unrepairable(whole)
        ""
      end
    end

    # 교정 불가능한 마커스러운 잔여 조각 로깅 — 미래 변형 패턴 수집용.
    # citation_markers.rb는 Rails 부트 없이(예: 읽기전용 검증 스크립트) require 될 수 있어 가드.
    def log_unrepairable(fragment)
      return unless defined?(Rails)
      Rails.logger.info "[CitationMarkers.normalize] unrepairable: #{fragment.inspect}"
    end
  end
end
