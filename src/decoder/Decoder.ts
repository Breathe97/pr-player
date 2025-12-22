import type { Pattern } from '../type'
import type { On, PendingChunk } from './type'

export class Decoder {
  private pattern: Pattern = 'flv'

  private audioDecoderConfig?: AudioDecoderConfig
  private audioDecoder?: AudioDecoder

  private videoDecoderConfig?: VideoDecoderConfig
  private videoDecoder?: VideoDecoder

  private hasKeyFrame = false

  private baseTime = 0 // ms

  private pendingChunks: PendingChunk[] = []
  private currentChunk?: PendingChunk

  private isProcessing = false

  private decodeTimer = 0 // 解码定时器

  private frameTrack = false // 是否开启自动追帧

  private isFrameTrack = false // 当前是否正在追帧

  private fameTrackOption: { [key in Pattern]: [number, number] } = {
    // [停止追帧, 开启追帧]
    flv: [30, 50],
    hls: [200, 300],
    dash: [50, 100],
    rtmp: [50, 100]
  }

  private decodingSpeedRatio = 1 // 解码速率

  private maxDecodingSpeedRatio = 2 // 最大解码速率

  private decodingSpeed = 16 // ms
  private fps = 0 // 实时渲染fps

  private firstVideoChunkTimestamp?: number // 第一帧时间戳
  private secondVideoChunkTimestamp?: number // 第二帧时间戳

  private frameStartTime?: number // 帧开始时间 用于校准最终渲染时间
  private lastRenderTime?: number // 上一次渲染的时间
  private nextRenderTime?: number // 下一次渲染的时间

  public on: On = { audio: {}, video: {} }

  constructor() {}

  init = (pattern: Pattern) => {
    this.destroy()
    this.pattern = pattern
    this.baseTime = new Date().getTime() - performance.now()
    this.initDecodeInterval()
  }

  initAudio = (config: AudioDecoderConfig) => {
    this.audio.destroy()
    this.audioDecoderConfig = { ...config }
    this.audioDecoder = new AudioDecoder({
      output: (audioData: AudioData) => {
        const playbackRate = this.decodingSpeedRatio
        this.on.audio.decode && this.on.audio.decode({ audioData, playbackRate })
      },
      error: (e) => {
        this.on.audio.error && this.on.audio.error(e)
      }
    })
    this.audioDecoder.configure(this.audioDecoderConfig)
  }

  initVideo = (config: VideoDecoderConfig) => {
    this.video.destroy()
    this.videoDecoderConfig = { ...config }
    this.videoDecoder = new VideoDecoder({
      output: async (frame: VideoFrame) => {
        if (!this.frameStartTime) {
          this.frameStartTime = frame.timestamp
        }
        // 修正时间戳为真实的本地绝对时间
        const timestamp = frame.timestamp - this.frameStartTime + this.baseTime * 1000
        const bitmap = await createImageBitmap(frame)
        frame.close()
        if (bitmap.width > 0 && bitmap.height > 0) {
          this.on.video.decode && this.on.video.decode({ timestamp, bitmap })

          // 返回对应的 nalus
          if (this.currentChunk && this.currentChunk.kind === 'video' && this.currentChunk.nalus) {
            this.on.nalus && this.on.nalus(this.currentChunk.nalus)
          }
        } else {
          bitmap.close()
        }
      },
      error: (e) => {
        this.on.video.error && this.on.video.error(e)
      }
    })
    this.videoDecoder.configure(this.videoDecoderConfig)
  }

  setFrameTrack = (frameTrack: boolean) => {
    this.frameTrack = frameTrack
    if (this.frameTrack === false) {
      this.decodingSpeedRatio = 1
    }
  }

  push = (chunk: PendingChunk) => {
    this.pendingChunks.push(chunk)
  }

  destroy = () => {
    this.audio.destroy()
    this.video.destroy()
    this.pendingChunks = []
    this.firstVideoChunkTimestamp = undefined
    this.secondVideoChunkTimestamp = undefined
    this.frameStartTime = undefined
    this.lastRenderTime = undefined
    this.nextRenderTime = undefined
    clearInterval(this.decodeTimer)
  }

  private initDecodeInterval = () => {
    // 每一次解码记录解码前时间 然后对比当前延迟时间计算差值 然后用于落后补偿
    let timeout = this.decodingSpeed / this.decodingSpeedRatio

    const now = this.baseTime + performance.now()

    // 计算fps
    {
      if (!this.lastRenderTime) {
        this.lastRenderTime = now
      }
      this.fps = Math.round(1000 / (now - this.lastRenderTime))
    }

    this.lastRenderTime = now // 上一次帧 渲染时间

    // 下一帧渲染时间
    if (this.nextRenderTime) {
      const laggingTime = this.lastRenderTime - this.nextRenderTime // 代码运行补偿时间
      timeout -= laggingTime
    }

    this.nextRenderTime = this.lastRenderTime + timeout // 下一帧渲染时间

    this.decodeTimer = setTimeout(() => {
      this.decode()
      this.initDecodeInterval() // 进行下一次解码
    }, timeout)
  }

  private decode = () => {
    if (this.isProcessing === true) return
    this.isProcessing = true
    while (true) {
      this.currentChunk = this.pendingChunks.shift()
      if (!this.currentChunk) break

      const cacheLength = this.pendingChunks.length

      // 追帧
      if (this.frameTrack) {
        const [min, max] = this.fameTrackOption[this.pattern]

        // 接近最小阈值关闭追帧
        if (cacheLength <= min) {
          this.isFrameTrack = false
        }

        // 触发最大阈值 开始追帧
        if (cacheLength >= max) {
          this.isFrameTrack = true
        }

        if (this.isFrameTrack) {
          const suggestRatio = Math.min(1 + (cacheLength - min) / 100, this.maxDecodingSpeedRatio)
          this.decodingSpeedRatio = Number(suggestRatio.toFixed(1))
        } else {
          this.decodingSpeedRatio = 1
        }
      }

      if (this.on.analysis) {
        const { decodingSpeed, decodingSpeedRatio, fps } = this
        this.on.analysis({ decodingSpeed, decodingSpeedRatio, fps, cacheLength })
      }

      const { kind, init } = this.currentChunk

      switch (kind) {
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

      if (kind === 'video') break
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

    // 计算解码fps
    if (!this.firstVideoChunkTimestamp) {
      this.firstVideoChunkTimestamp = init.timestamp
    } else if (!this.secondVideoChunkTimestamp) {
      this.secondVideoChunkTimestamp = init.timestamp
      this.decodingSpeed = (this.secondVideoChunkTimestamp - this.firstVideoChunkTimestamp) / 1000
    }

    if (this.hasKeyFrame) {
      const chunk = new EncodedVideoChunk(init)
      this.videoDecoder.decode(chunk)
    }
  }

  private audio = {
    flush: () => {
      this.audioDecoder?.flush()
    },
    destroy: () => {
      this.audioDecoderConfig = undefined
      this.audioDecoder?.close()
      this.audioDecoder = undefined
    }
  }

  private video = {
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
