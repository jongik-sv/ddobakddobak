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
  end
end
