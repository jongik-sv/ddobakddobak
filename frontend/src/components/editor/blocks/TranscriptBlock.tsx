import { createReactBlockSpec } from '@blocknote/react'
import { SpeakerLabel } from '../../meeting/SpeakerLabel'

export const TranscriptBlock = createReactBlockSpec(
  {
    type: 'transcript' as const,
    propSchema: {
      speakerLabel: {
        default: 'SPEAKER_00',
      },
      text: {
        default: '',
      },
    },
    content: 'none',
  },
  {
    render: ({ block }) => {
      const { speakerLabel, text } = block.props
      return (
        <div className="flex gap-2 items-start py-1" data-testid="transcript-block">
          <SpeakerLabel speakerLabel={speakerLabel} />
          <span className="text-sm text-gray-800 leading-relaxed">{text}</span>
        </div>
      )
    },
  },
)
