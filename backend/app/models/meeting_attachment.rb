class MeetingAttachment < ApplicationRecord
  belongs_to :meeting
  belongs_to :uploader, class_name: "User", foreign_key: "uploaded_by_id"

  KINDS = %w[file link].freeze
  CATEGORIES = %w[agenda reference minutes business_card].freeze

  ALLOWED_CONTENT_TYPES = %w[
    application/pdf
    application/msword
    application/vnd.openxmlformats-officedocument.wordprocessingml.document
    application/vnd.ms-excel
    application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
    application/vnd.ms-powerpoint
    application/vnd.openxmlformats-officedocument.presentationml.presentation
    text/plain text/csv text/markdown
    image/png image/jpeg image/gif image/webp
    application/zip
    application/x-hwp application/haansofthwp
  ].freeze

  MAX_FILE_SIZE = 50.megabytes

  # 확장자 → MIME 폴백. 일부 클라이언트(Tauri readFile 등)는 업로드 File에 type이 없어
  # content_type이 비거나 application/octet-stream으로 도착 → 그대로면 ALLOWED 검사에서 거부된다.
  EXTENSION_CONTENT_TYPES = {
    "pdf" => "application/pdf",
    "doc" => "application/msword",
    "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xls" => "application/vnd.ms-excel",
    "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "ppt" => "application/vnd.ms-powerpoint",
    "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "txt" => "text/plain", "csv" => "text/csv", "md" => "text/markdown",
    "png" => "image/png", "jpg" => "image/jpeg", "jpeg" => "image/jpeg",
    "gif" => "image/gif", "webp" => "image/webp",
    "zip" => "application/zip", "hwp" => "application/x-hwp"
  }.freeze

  def self.content_type_for_filename(filename)
    ext = File.extname(filename.to_s).delete_prefix(".").downcase
    EXTENSION_CONTENT_TYPES[ext]
  end

  validates :kind, inclusion: { in: KINDS }
  validates :category, inclusion: { in: CATEGORIES }
  validates :display_name, presence: true, length: { maximum: 255 }
  validates :position, presence: true, numericality: { greater_than: 0 }

  validates :file_path, :original_filename, :content_type, :file_size, presence: true, if: :file?
  validates :file_size, numericality: { less_than_or_equal_to: MAX_FILE_SIZE }, allow_nil: true
  validates :content_type, inclusion: { in: ALLOWED_CONTENT_TYPES }, if: :file?

  validates :url, presence: true, if: :link?
  validate :url_format, if: :link?

  scope :for_category, ->(cat) { where(category: cat) if cat.present? }
  scope :ordered, -> { order(:position) }

  def file?
    kind == "file"
  end

  def link?
    kind == "link"
  end

  after_destroy :remove_file_from_disk

  private

  def url_format
    return if url.blank?
    uri = URI.parse(url)
    unless uri.is_a?(URI::HTTP) || uri.is_a?(URI::HTTPS)
      errors.add(:url, "must be a valid HTTP/HTTPS URL")
    end
  rescue URI::InvalidURIError
    errors.add(:url, "is not a valid URL")
  end

  def remove_file_from_disk
    return unless file? && file_path.present?
    FileUtils.rm_f(file_path)
  end
end
