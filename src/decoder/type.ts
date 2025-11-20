export interface On {
  audio: {
    decode?: (_audio: { audioData: AudioData; playbackRate?: number }) => void
    error?: (_e: DOMException) => void
  }
  video: {
    decode?: (_frame: { bitmap: ImageBitmap; timestamp: number }) => void
    error?: (_e: DOMException) => void
  }
  nalus?: (nalus: Uint8Array<ArrayBufferLike>[]) => void
  debug?: (_e: any) => void
}

interface PendingAudioChunk {
  kind: 'audio'
  init: EncodedAudioChunkInit
}

interface PendingVideoChunk {
  kind: 'video'
  init: EncodedAudioChunkInit
  nalus?: Uint8Array<ArrayBufferLike>[]
}

export type PendingChunk = PendingAudioChunk | PendingVideoChunk
