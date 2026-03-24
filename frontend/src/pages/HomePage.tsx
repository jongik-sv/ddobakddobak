import { Link } from 'react-router-dom'

export default function HomePage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-background">
      <div className="text-center space-y-6">
        <h1 className="text-4xl font-bold tracking-tight">또박또박</h1>
        <p className="text-muted-foreground text-lg">
          회의 음성을 실시간으로 텍스트화하고 AI로 자동 정리하는 회의 보조 앱
        </p>
        <div className="flex gap-4 justify-center">
          <Link
            to="/login"
            className="inline-flex items-center justify-center rounded-md bg-primary px-6 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors"
          >
            로그인
          </Link>
        </div>
      </div>
    </div>
  )
}
