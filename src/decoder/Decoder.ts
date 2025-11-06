import type { On, PendingChunk } from './type'

export class Decoder {
  private audioDecoderConfig?: AudioDecoderConfig
  private audioDecoder?: AudioDecoder

  private videoDecoderConfig?: VideoDecoderConfig
  private videoDecoder?: VideoDecoder

  private hasKeyFrame = false

  private baseTime = 0 // ms

  private pendingChunks: PendingChunk[] = []

  private isProcessing = false

  private decodeTimer = 0 // 解码定时器

  private frameTrack = false // 追帧

  private minFrameTrackCacheNum = 20 // 最小追帧缓存数 (开启追帧才有效)

  private decodingSpeed = 40 // ms

  private decodingSpeedRatio = 1

  private maxDecodingSpeedRatio = 2

  private nextRenderTime?: number // 下一次渲染的时间

  public on: On = { audio: {}, video: {} }

  constructor() {
    this.baseTime = new Date().getTime() - performance.now()
    this.initDecodeInterval()
  }

  init = (option: { decodingSpeed: number; frameTrack?: boolean; minFrameTrackCacheNum?: number }) => {
    const { decodingSpeed, frameTrack, minFrameTrackCacheNum } = option
    if (decodingSpeed !== undefined) {
      this.decodingSpeed = decodingSpeed
    }
    if (frameTrack !== undefined) {
      this.frameTrack = frameTrack
    }
    if (minFrameTrackCacheNum !== undefined) {
      this.minFrameTrackCacheNum = minFrameTrackCacheNum
    }
  }

  setFrameTrack = (frameTrack: boolean) => {
    this.frameTrack = frameTrack
    if (this.frameTrack === false) {
      this.decodingSpeedRatio = 1
    }
  }

  private initDecodeInterval = () => {
    // 每一次解码记录解码前时间 然后对比当前延迟时间计算差值 然后用于落后补偿
    let timeout = this.decodingSpeed / this.decodingSpeedRatio
    const now = this.baseTime + performance.now()
    if (this.nextRenderTime) {
      const laggingTime = now - this.nextRenderTime
      timeout -= laggingTime
    }
    this.nextRenderTime = now + timeout
    this.decodeTimer = setTimeout(() => {
      this.decode()
      this.initDecodeInterval() // 进行下一次解码
    }, timeout)
  }

  private decode = () => {
    if (this.isProcessing === true) return
    this.isProcessing = true
    while (true) {
      const chunk = this.pendingChunks.shift()

      // 追帧
      if (this.frameTrack) {
        const length = this.pendingChunks.length
        if (length >= this.minFrameTrackCacheNum) {
          const suggestRatio = Math.min(1 + (length - this.minFrameTrackCacheNum) / 100, this.maxDecodingSpeedRatio)
          this.decodingSpeedRatio = Number(suggestRatio.toFixed(1))
        } else {
          this.decodingSpeedRatio = 1
        }
      }
      // console.log('\x1b[38;2;0;151;255m%c%s\x1b[0m', 'color:#0097ff;', `------->Breathe:${this.decodingSpeed}, ${this.decodingSpeedRatio}`, this.pendingChunks.length)

      if (!chunk) break
      const { type, init } = chunk

      switch (type) {
        case 'audio':
          {
            this.decodeAudio(init)
          }
          break
        case 'video':
          {
            this.decodeVideo(init)
          }
          break
      }
      if (type === 'video') break
    }
    this.isProcessing = false
  }

  private decodeAudio = (init: EncodedAudioChunkInit) => {
    if (!this.audioDecoder) return
    const chunk = new EncodedAudioChunk(init)
    this.audioDecoder.decode(chunk)
  }

  private decodeVideo = (init: EncodedAudioChunkInit) => {
    if (!this.videoDecoder) return
    if (init.type === 'key') {
      this.hasKeyFrame = true
    }
    if (this.hasKeyFrame) {
      const chunk = new EncodedVideoChunk(init)
      this.videoDecoder.decode(chunk)
    }
  }

  destroy = () => {
    this.audio.destroy()
    this.video.destroy()
    clearInterval(this.decodeTimer)
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
    push: (init: EncodedAudioChunkInit) => {
      this.pendingChunks.push({ type: 'audio', init })
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
          // 修正时间戳为真实的本地绝对时间
          const timestamp = frame.timestamp + this.baseTime * 1000
          const bitmap = await createImageBitmap(frame)
          frame.close()
          if (bitmap.width > 0 && bitmap.height > 0) {
            this.on.video.decode && this.on.video.decode({ timestamp, bitmap })
          } else {
            bitmap.close()
          }
        },
        error: (e) => {
          this.on.video.error && this.on.video.error(e)
        }
      })
      this.videoDecoder.configure(this.videoDecoderConfig)
    },
    push: (init: EncodedVideoChunkInit) => {
      this.pendingChunks.push({ type: 'video', init })
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
