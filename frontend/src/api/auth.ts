import apiClient from './client'
import type { User } from '../stores/authStore'

export interface AuthResponse {
  token: string
  user: User
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  return apiClient.post('login', { json: { email, password } }).json()
}

export async function signup(name: string, email: string, password: string): Promise<AuthResponse> {
  return apiClient.post('signup', { json: { name, email, password } }).json()
}
