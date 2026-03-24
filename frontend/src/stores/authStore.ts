import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface User {
  id: number
  email: string
  name: string
}

interface AuthState {
  user: User | null
  token: string | null
  isAuthenticated: boolean
  login: (token: string, user: User) => void
  setUser: (user: User) => void
  setToken: (token: string) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      isAuthenticated: false,

      login: (token: string, user: User) =>
        set({ token, user, isAuthenticated: true }),

      setUser: (user: User) =>
        set({ user, isAuthenticated: true }),

      setToken: (token: string) =>
        set({ token }),

      logout: () =>
        set({ user: null, token: null, isAuthenticated: false }),
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        user: state.user,
        token: state.token,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
)
