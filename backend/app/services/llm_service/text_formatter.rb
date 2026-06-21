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
      roster = {}
      lines = transcripts.map { |t|
        label = (t["speaker_label"] || t[:speaker_label]).to_s
        name  = (t["speaker"] || t[:speaker]).to_s
        text = t["text"] || t[:text] || ""
        ms = (t["started_at_ms"] || t[:started_at_ms] || 0).to_i
        clock = format("%02d:%02d", ms / 60000, (ms / 1000) % 60)
        bracket = label.empty? ? (name.empty? ? "알 수 없음" : name) : label
        if !name.empty? && name != bracket
          roster[bracket] ||= name
          prefix = "#{name}: "
        else
          prefix = ""
        end
        "[#{clock}|#{ms}ms #{bracket}] #{prefix}#{text}"
      }
      header = roster.empty? ? "" : "[화자 안내] #{roster.map { |l, n| "#{l}=#{n}" }.join(', ')}\n\n"
      header + lines.join("\n")
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

    def quote_mermaid_labels(block)
      # Square brackets: A[label] → A["label"]
      block = block.gsub(/(^|\s|>|\|)(\w+)\[([^\]]+)\]/m) do
        "#{$1}#{$2}#{clean_label($3, '[', ']')}"
      end
      # Curly braces: A{label} → A{"label"}
      block = block.gsub(/(^|\s|>|\|)(\w+)\{([^}]+)\}/m) do
        "#{$1}#{$2}#{clean_label($3, '{', '}')}"
      end
      # Parentheses: A(label) → A("label")
      block.gsub(/(^|\s|>|\|)(\w+)\(([^)]+)\)/m) do
        "#{$1}#{$2}#{clean_label($3, '(', ')')}"
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
