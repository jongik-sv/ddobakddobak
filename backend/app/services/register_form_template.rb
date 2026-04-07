class RegisterFormTemplate
  class << self
    def render(callback:, error:, csrf_token:, action_url:)
      login_url = "/auth/web_login?callback=#{ERB::Util.url_encode(callback.to_s)}"

      <<~HTML
        <!DOCTYPE html>
        <html lang="ko">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>또박또박 - 회원가입</title>
          <script src="https://cdn.tailwindcss.com"></script>
          <script>
            tailwind.config = {
              theme: {
                extend: {
                  colors: {
                    primary: { 50: '#eff6ff', 500: '#3b82f6', 600: '#2563eb', 700: '#1d4ed8' }
                  }
                }
              }
            }
          </script>
        </head>
        <body class="min-h-screen bg-gray-50 flex items-center justify-center p-4">
          <div class="w-full max-w-md">
            <!-- 로고 / 제목 -->
            <div class="text-center mb-8">
              <h1 class="text-3xl font-bold text-gray-900">또박또박</h1>
              <p class="mt-2 text-gray-600">회의록 자동 작성 서비스</p>
            </div>

            <!-- 회원가입 카드 -->
            <div class="bg-white rounded-2xl shadow-lg p-8">
              <h2 class="text-xl font-semibold text-gray-800 mb-6">회원가입</h2>

              #{error_html(error)}

              <form action="#{escape(action_url)}" method="post" class="space-y-5">
                <input type="hidden" name="authenticity_token" value="#{escape(csrf_token)}">
                <input type="hidden" name="callback" value="#{escape(callback)}">

                <!-- 이름 -->
                <div>
                  <label for="name" class="block text-sm font-medium text-gray-700 mb-1">
                    이름
                  </label>
                  <input
                    type="text"
                    id="name"
                    name="name"
                    required
                    autocomplete="name"
                    autofocus
                    class="w-full px-4 py-3 border border-gray-300 rounded-lg
                           focus:ring-2 focus:ring-primary-500 focus:border-primary-500
                           transition-colors text-gray-900 placeholder-gray-400"
                    placeholder="이름"
                  >
                </div>

                <!-- 이메일 -->
                <div>
                  <label for="email" class="block text-sm font-medium text-gray-700 mb-1">
                    이메일
                  </label>
                  <input
                    type="email"
                    id="email"
                    name="email"
                    required
                    autocomplete="email"
                    class="w-full px-4 py-3 border border-gray-300 rounded-lg
                           focus:ring-2 focus:ring-primary-500 focus:border-primary-500
                           transition-colors text-gray-900 placeholder-gray-400"
                    placeholder="name@company.com"
                  >
                </div>

                <!-- 비밀번호 -->
                <div>
                  <label for="password" class="block text-sm font-medium text-gray-700 mb-1">
                    비밀번호
                  </label>
                  <input
                    type="password"
                    id="password"
                    name="password"
                    required
                    autocomplete="new-password"
                    minlength="6"
                    class="w-full px-4 py-3 border border-gray-300 rounded-lg
                           focus:ring-2 focus:ring-primary-500 focus:border-primary-500
                           transition-colors text-gray-900 placeholder-gray-400"
                    placeholder="6자 이상"
                  >
                </div>

                <!-- 제출 버튼 -->
                <button
                  type="submit"
                  class="w-full py-3 px-4 bg-primary-600 hover:bg-primary-700
                         text-white font-medium rounded-lg transition-colors
                         focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
                >
                  회원가입
                </button>
              </form>

              <!-- 로그인 링크 -->
              <p class="mt-4 text-center text-sm text-gray-500">
                이미 계정이 있으신가요?
                <a href="#{escape(login_url)}" class="text-primary-600 hover:text-primary-700 font-medium">로그인</a>
              </p>
            </div>

            <!-- 하단 안내 -->
            <p class="mt-6 text-center text-sm text-gray-500">
              가입 후 또박또박 앱으로 자동 이동합니다.
            </p>
          </div>
        </body>
        </html>
      HTML
    end

    private

    def error_html(error)
      return "" if error.blank?

      <<~HTML
        <div class="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
          <p class="text-sm text-red-700">#{escape(error)}</p>
        </div>
      HTML
    end

    def escape(text)
      ERB::Util.html_escape(text.to_s)
    end
  end
end
