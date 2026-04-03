import { create } from 'zustand'
import { getMeetingTemplates, createMeetingTemplate, updateMeetingTemplate, deleteMeetingTemplate } from '../api/meetingTemplates'
import type { MeetingTemplate, MeetingTemplateParams } from '../api/meetingTemplates'

interface MeetingTemplateState {
  templates: MeetingTemplate[]
  isLoaded: boolean
  fetch: () => Promise<void>
  add: (data: MeetingTemplateParams) => Promise<MeetingTemplate>
  update: (id: number, data: Partial<MeetingTemplateParams>) => Promise<void>
  remove: (id: number) => Promise<void>
}

export const useMeetingTemplateStore = create<MeetingTemplateState>()((set, get) => ({
  templates: [],
  isLoaded: false,

  fetch: async () => {
    if (get().isLoaded) return
    try {
      const templates = await getMeetingTemplates()
      set({ templates, isLoaded: true })
    } catch {
      set({ isLoaded: true })
    }
  },

  add: async (data) => {
    const template = await createMeetingTemplate(data)
    set((s) => ({ templates: [template, ...s.templates] }))
    return template
  },

  update: async (id, data) => {
    const updated = await updateMeetingTemplate(id, data)
    set((s) => ({
      templates: s.templates.map((t) => (t.id === id ? updated : t)),
    }))
  },

  remove: async (id) => {
    await deleteMeetingTemplate(id)
    set((s) => ({ templates: s.templates.filter((t) => t.id !== id) }))
  },
}))
