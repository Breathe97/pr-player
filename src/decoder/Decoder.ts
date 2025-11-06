import type { CutOption, On } from './type'

export class Decoder {
  private audioDecoderConfig?: AudioDecoderConfig
  private audioDecoder?: AudioDecoder

  private videoDecoderConfig?: VideoDecoderConfig
  private videoDecoder?: VideoDecoder

  private hasKeyFrame = false

  private baseTime = 0 // ms

  public on: On = { audio: {}, video: {} }

  constructor() {
    this.baseTime = new Date().getTime() - performance.now()
  }

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
        output: async (frame: VideoFrame) => this.video.onVideoFrame(frame),
        error: (e) => {
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
    onVideoFrame: async (frame: VideoFrame) => {
      const timestamp = frame.timestamp + this.baseTime * 1000
      const bitmap = await createImageBitmap(frame)
      frame.close()
      if (bitmap.width > 0 && bitmap.height > 0) {
        this.on.video.decode && this.on.video.decode({ timestamp, bitmap })
      } else {
        bitmap.close()
      }
    },
    destroy: () => {
      this.videoDecoderConfig = undefined
      this.videoDecoder?.close()
      this.videoDecoder = undefined
      this.hasKeyFrame = false
    }
  }
}
