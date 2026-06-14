import { BlockNoteSchema, defaultBlockSpecs, insertOrUpdateBlockForSlashMenu } from '@blocknote/core'
import type { BlockNoteEditor, PartialBlock } from '@blocknote/core'
import '@blocknote/mantine/style.css'
import { BlockNoteView } from '@blocknote/mantine'
import { useCreateBlockNote, SuggestionMenuController, getDefaultReactSlashMenuItems } from '@blocknote/react'
import { useCallback, useEffect } from 'react'
import type { Block } from '@blocknote/core'
import type { RefObject } from 'react'
import { TranscriptBlock } from './blocks'
import { MermaidBlock } from '../meeting/mermaidBlock'

export const customSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    transcript: TranscriptBlock(),
    mermaid: MermaidBlock(),
  },
})

export type CustomBlock = Block<typeof customSchema.blockSchema>

interface MeetingEditorProps {
  initialContent?: CustomBlock[] | PartialBlock[]
  onChange?: (blocks: CustomBlock[]) => void
  editable?: boolean
  editorRef?: RefObject<BlockNoteEditor<typeof customSchema.blockSchema> | null>
  /** 에디터 인스턴스가 (재)마운트되어 준비되면 호출 — 외부에서 초기 콘텐츠 로드용 */
  onReady?: (editor: BlockNoteEditor<typeof customSchema.blockSchema>) => void
}

export function MeetingEditor({
  initialContent,
  onChange,
  editable = true,
  editorRef,
  onReady,
}: MeetingEditorProps) {
  const editor = useCreateBlockNote({
    schema: customSchema,
    initialContent,
  })

  useEffect(() => {
    if (editorRef) {
      editorRef.current = editor
    }
    onReady?.(editor)
    return () => {
      if (editorRef) {
        editorRef.current = null
      }
    }
  }, [editor, editorRef, onReady])

  const handleChange = useCallback(() => {
    onChange?.(editor.document as CustomBlock[])
  }, [editor, onChange])

  return (
    <BlockNoteView
      editor={editor}
      editable={editable}
      onChange={handleChange}
      theme="light"
      slashMenu={false}
    >
      <SuggestionMenuController
        triggerCharacter="/"
        getItems={async (query) => {
          const defaults = getDefaultReactSlashMenuItems(editor)
          const mermaidItem = {
            title: 'Mermaid 다이어그램',
            onItemClick: () => {
              insertOrUpdateBlockForSlashMenu(editor, {
                type: 'mermaid' as any,
                props: { code: '' },
              })
            },
            aliases: ['mermaid', 'diagram', '다이어그램', '차트'],
            group: '미디어',
            subtext: '플로우차트, 시퀀스 등 다이어그램 삽입',
          }
          return [...defaults, mermaidItem].filter(
            (item) =>
              !query ||
              item.title.toLowerCase().includes(query.toLowerCase()) ||
              item.aliases?.some((a: string) => a.toLowerCase().includes(query.toLowerCase())),
          )
        }}
      />
    </BlockNoteView>
  )
}
