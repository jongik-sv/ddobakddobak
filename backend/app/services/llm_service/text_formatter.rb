class LlmService
  # 순수 텍스트 유틸리티 — 인스턴스 상태에 의존하지 않는 포매팅/파싱 헬퍼.
  # module_function 으로 모듈 함수 + private 인스턴스 메서드를 동시에 제공한다.
  # (LlmService 가 include 하므로 기존 private 인스턴스 메서드 계약도 보존된다.)
  module TextFormatter
    module_function

    # 글자수 하드 캡(멀티바이트 안전). nil 은 "" 로.
    def truncate_chars(text, max_chars)
      text = text.to_s
      text.length > max_chars ? text[0, max_chars] : text
    end

    def format_transcripts(transcripts)
      return "" if transcripts.blank?
      lines = transcripts.map { |t|
        label = (t["speaker_label"] || t[:speaker_label]).to_s
        name  = (t["speaker"] || t[:speaker]).to_s
        text = t["text"] || t[:text] || ""
        ms = (t["started_at_ms"] || t[:started_at_ms] || 0).to_i
        clock = format("%02d:%02d", ms / 60000, (ms / 1000) % 60)
        # 화자 라벨(화자 N)만 마커 근거로 유지. 실명(speaker)·roster·"이름: " 접두사는
        # 요약 본문에 화자 귀속이 새어나가므로 넣지 않는다. label 없을 때만 name 폴백.
        bracket = label.empty? ? (name.empty? ? "알 수 없음" : name) : label
        "[#{clock}|#{ms}ms #{bracket}] #{text}"
      }
      lines.join("\n")
    end

    def extract_json(text)
      if (match = text.match(/```(?:json)?\s*([\s\S]*?)```/))
        match[1].strip
      else
        text.strip
      end
    end

    def strip_markdown_fence(text)
      text = text.strip
      if text.match?(/\A```(?:markdown)?\s*\n/)
        text = text.sub(/\A```(?:markdown)?\s*\n/, "")
        text = text.sub(/\n```\s*\z/, "")
      end
      text
    end

    # Mermaid 코드블록 내 노드 라벨에 큰따옴표 자동 보정 + 줄바꿈 처리
    def fix_mermaid_quotes(text)
      text.gsub(/(```mermaid\s*\n)([\s\S]*?)(```)/) do
        prefix, body, suffix = $1, $2, $3
        body = quote_mermaid_labels(body)
        "#{prefix}#{body}#{suffix}"
      end
    end

    # 구(舊) 구현은 `[...]`/`{...}`/`(...)` 3개 패턴을 **순차 3-pass**로 전체
    # 블록에 각각 gsub 했다. 이 구조는 라벨 안쪽 괄호 텍스트를 자기오염시킨다:
    # square pass가 `A[Full Hard(원소재) 출고]`를 `A["Full Hard(원소재) 출고"]`로
    # 만든 뒤, 이어지는 paren pass가 그 **이미 따옴표 씌운 라벨 안쪽**의
    # `Hard(원소재)`를 독립 라운드노드로 오인해 `Hard("원소재")`로 다시 감싼다
    # → `A["... ("원소재") ..."]` 중첩따옴표 → mermaid parse 조기종료(파싱깨짐).
    #
    # 수정: 3개 패턴을 **단일 교대(alternation) pass**로 합친다. 정규식 엔진이
    # `A[...]`를 매칭하면 닫는 `]`까지 소비하고 그 뒤부터 다시 스캔하므로, 라벨
    # 내부의 `(원소재)`/`{...}`가 별도 노드로 재매칭되지 않는다. 이미 깨진
    # 중첩따옴표 입력도 clean_label 이 라벨 내부 `"` 를 전부 제거하므로 자기치유.
    def quote_mermaid_labels(block)
      # 교대 순서 = 구(舊) pass 순서(square→curly→paren). 각 그룹은 첫 닫힘문자까지.
      block.gsub(/(^|\s|>|\|)(\w+)(\[[^\]]+\]|\{[^}]+\}|\([^)]+\))/m) do
        prefix, id, group = $1, $2, $3
        open_b = group[0]
        close_b = group[-1]
        "#{prefix}#{id}#{clean_label(group[1..-2], open_b, close_b)}"
      end
    end

    def clean_label(content, open_b, close_b)
      clean = content.delete('"')
      clean = clean.gsub('\\n', "<br/>")
      clean = clean.gsub("\n", "<br/>").delete("\r")
      "#{open_b}\"#{clean}\"#{close_b}"
    end
  end
end
