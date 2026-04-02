RSpec.shared_context "local mode" do
  around do |example|
    original = ENV["SERVER_MODE"]
    ENV["SERVER_MODE"] = nil
    example.run
  ensure
    ENV["SERVER_MODE"] = original
  end
end

RSpec.shared_context "server mode" do
  around do |example|
    original = ENV["SERVER_MODE"]
    ENV["SERVER_MODE"] = "true"
    example.run
  ensure
    ENV["SERVER_MODE"] = original
  end
end
