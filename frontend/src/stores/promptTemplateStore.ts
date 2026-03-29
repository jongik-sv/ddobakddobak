import { create } from 'zustand'
import { getPromptTemplates } from '../api/promptTemplates'
import type { PromptTemplate } from '../api/promptTemplates'
import { MEETING_TYPES } from '../config'

interface PromptTemplateState {
  templates: PromptTemplate[]
  isLoaded: boolean
  meetingTypeList: { value: string; label: string }[]
  meetingTypeMap: Record<string, string>
  fetch: () => Promise<void>
}

const STATIC_TYPE_MAP: Record<string, string> = Object.fromEntries(
  MEETING_TYPES.map((t) => [t.value, t.label]),
)

export const usePromptTemplateStore = create<PromptTemplateState>()((set, get) => ({
  templates: [],
  isLoaded: false,
  meetingTypeList: MEETING_TYPES,
  meetingTypeMap: STATIC_TYPE_MAP,

  fetch: async () => {
    if (get().isLoaded) return
    try {
      const templates = await getPromptTemplates()
      set({
        templates,
        isLoaded: true,
        meetingTypeList: templates.length > 0
          ? templates.map((t) => ({ value: t.meeting_type, label: t.label }))
          : MEETING_TYPES,
        meetingTypeMap: templates.length > 0
          ? Object.fromEntries(templates.map((t) => [t.meeting_type, t.label]))
          : STATIC_TYPE_MAP,
      })
    } catch {
      set({ isLoaded: true })
    }
  },
}))
