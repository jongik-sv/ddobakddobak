import SettingsContent from '../components/settings/SettingsContent'

export default function SettingsPage() {
  return (
    <div className="min-h-screen bg-background p-8">
      <h1 className="text-2xl font-bold mb-6">설정</h1>
      <SettingsContent />
    </div>
  )
}
