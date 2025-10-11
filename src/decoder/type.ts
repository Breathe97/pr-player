export interface On {
  audio: {
    decode?: (_AudioData: AudioData) => void
    error?: (_e: DOMException) => void
  }
  video: {
    decode?: (_frame: { bitmap: ImageBitmap; timestamp: number }) => void
    error?: (_e: DOMException) => void
  }
}
