require "digest"

# 화이트보드 재료 — AI 회의록(active_summary)만 사용한다(design.md §3, §11.2).
# title/date/datetime 은 MeetingExportSerializer#build_meeting 과 같은 값(started_at 기준).
module Whiteboard
  class Material
    UNDECIDED = "미정".freeze

    attr_reader :title, :date, :datetime, :markdown

    def initialize(title:, date:, datetime:, markdown:)
      @title = title
      @date = date
      @datetime = datetime
      @markdown = markdown
    end

    # 요약이 없거나 비어 있으면 nil.
    def self.build(meeting)
      summary = meeting.active_summary
      return nil unless summary

      markdown = summary_markdown(summary)
      return nil if markdown.gsub(/[[:space:]\uFEFF]/, "").empty?

      started = meeting.started_at&.in_time_zone(MeetingExportSerializer::KST_ZONE)
      date = started ? started.to_date.to_s : UNDECIDED
      datetime = started ? started.strftime("%Y-%m-%d %H:%M") : date
      new(title: meeting.title.to_s, date: date, datetime: datetime, markdown: markdown)
    end

    # sha256("wb-v1\n" + title + "\n" + datetime + "\n" + markdown)
    def digest
      Digest::SHA256.hexdigest("#{Prompt::PROMPT_VERSION}\n#{title}\n#{datetime}\n#{markdown}")
    end

    def self.summary_markdown(summary)
      if summary.notes_markdown.present?
        summary.notes_markdown
      else
        [
          [ "핵심 요약", bullets(summary.key_points) ],
          [ "결정 사항", bullets(summary.decisions) ],
          [ "상세 논의", bullets(summary.discussion_details) ]
        ].reject { |_, body| body.empty? }
         .map { |head, body| "## #{head}\n#{body}" }
         .join("\n\n")
      end
    end

    def self.bullets(raw)
      parse_field(raw).map { |s| s.is_a?(String) ? s.strip : "" }.reject(&:empty?).map { |s| "- #{s}" }.join("\n")
    end

    def self.parse_field(value)
      return [] if value.blank?
      parsed = JSON.parse(value)
      parsed.is_a?(Array) ? parsed : [ parsed.to_s ]
    rescue JSON::ParserError
      [ value.to_s ]
    end
    private_class_method :summary_markdown, :bullets, :parse_field
  end
end
