import apiClient from './client'

export interface ChangePasswordParams {
  current_password: string
  new_password: string
  new_password_confirmation: string
}

export interface ChangePasswordResponse {
  access_token: string
  refresh_token: string
}

export async function changePassword(
  params: ChangePasswordParams,
): Promise<ChangePasswordResponse> {
  return apiClient
    .patch('user/password', { json: params })
    .json<ChangePasswordResponse>()
}
