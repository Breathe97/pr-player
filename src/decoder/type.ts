export interface On {
  audio: {
    decode?: (_audioData: AudioData) => void
    error?: (_e: DOMException) => void
  }
  video: {
    decode?: (_frame: { bitmap: ImageBitmap; timestamp: number }) => void
    error?: (_e: DOMException) => void
  }
}
