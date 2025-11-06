export interface On {
  audio: {
    decode?: (_audio: { audioData: AudioData; playbackRate?: number }) => void
    error?: (_e: DOMException) => void
  }
  video: {
    decode?: (_frame: { bitmap: ImageBitmap; timestamp: number }) => void
    error?: (_e: DOMException) => void
  }
}

interface PendingAudioChunk {
  type: 'audio'
  init: EncodedAudioChunkInit
}

interface PendingVideoChunk {
  type: 'video'
  init: EncodedAudioChunkInit
}

export type PendingChunk = PendingAudioChunk | PendingVideoChunk
