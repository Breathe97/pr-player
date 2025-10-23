import { On } from './type'

export class Decoder {
  private audioDecoderConfig: AudioDecoderConfig | undefined
  private audioDecoder: AudioDecoder | undefined

  private videoDecoderConfig: VideoDecoderConfig | undefined
  private videoDecoder: VideoDecoder | undefined

  private hasKeyFrame = false

  public on: On = { audio: {}, video: {} }

  constructor() {}

  audio = {
    init: (config: AudioDecoderConfig) => {
      this.audio.destroy()
      this.audioDecoderConfig = { ...config }
      this.audioDecoder = new AudioDecoder({
        output: (data: AudioData) => {
          this.on.audio.decode && this.on.audio.decode(data)
        },
        error: (e) => {
          this.on.audio.error && this.on.audio.error(e)
        }
      })

      this.audioDecoder.configure(this.audioDecoderConfig)
    },
    decode: (init: EncodedAudioChunkInit) => {
      if (!this.audioDecoder) return
      const chunk = new EncodedAudioChunk(init)
      this.audioDecoder.decode(chunk)
    },
    flush: () => {
      this.audioDecoder?.flush()
    },
    destroy: () => {
      this.audioDecoderConfig = undefined
      this.audioDecoder?.close()
      this.audioDecoder = undefined
    }
  }

  video = {
    init: (config: VideoDecoderConfig) => {
      this.video.destroy()
      this.videoDecoderConfig = { ...config }
      this.videoDecoder = new VideoDecoder({
        output: async (frame: VideoFrame) => {
          const bitmap = await createImageBitmap(frame)
          const timestamp = frame.timestamp
          frame.close()
          if (bitmap.width > 0 && bitmap.height > 0) {
            this.on.video.decode && this.on.video.decode({ timestamp, bitmap })
          } else {
            bitmap.close()
          }
        },
        error: (e) => {
          console.log('\x1b[38;2;0;151;255m%c%s\x1b[0m', 'color:#0097ff;', `------->Breathe: e`, e)
          this.on.video.error && this.on.video.error(e)
        }
      })
      this.videoDecoder.configure(this.videoDecoderConfig)
    },
    decode: (init: EncodedVideoChunkInit) => {
      if (!this.videoDecoder) return
      if (init.type === 'key') {
        this.hasKeyFrame = true
      }
      if (this.hasKeyFrame && this.videoDecoder.decodeQueueSize < 2) {
        const chunk = new EncodedVideoChunk(init)
        this.videoDecoder.decode(chunk)
      }
    },
    flush: () => {
      this.videoDecoder?.flush()
    },
    destroy: () => {
      this.videoDecoderConfig = undefined
      this.videoDecoder?.close()
      this.videoDecoder = undefined
      this.hasKeyFrame = false
    }
  }
}
