FactoryBot.define do
  factory :meeting_attachment do
    association :meeting
    kind { "file" }
    category { "reference" }
    display_name { "doc.pdf" }
    original_filename { "doc.pdf" }
    content_type { "application/pdf" }
    file_size { 123 }
    file_path { "/tmp/doc.pdf" }
    position { 1 }
    uploaded_by_id { meeting.created_by_id }
  end
end
