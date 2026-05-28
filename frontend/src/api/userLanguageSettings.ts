import apiClient from './client'

export interface UserLanguageSettingsResponse {
  language_settings: {
    mode: 'single' | 'multi'
    languages: string[]
    configured: boolean
  }
  server_default: {
    mode: 'single' | 'multi'
    languages: string[]
  }
}

export interface UserLanguageSettingsUpdateParams {
  language_settings: {
    mode: 'single' | 'multi'
    languages: string[]
  }
}

export async function getUserLanguageSettings(): Promise<UserLanguageSettingsResponse> {
  return apiClient.get('user/language_settings').json()
}

export async function updateUserLanguageSettings(
  params: UserLanguageSettingsUpdateParams
): Promise<UserLanguageSettingsResponse> {
  return apiClient.put('user/language_settings', { json: params }).json()
}
