import { DemuxerWorker } from './demuxer/DemuxerWorker'
import { DecoderWorker } from './decoder/DecoderWorker'
import { VideoPlayerWorker } from './videoPlayer/VideoPlayerWorker'
import { AudioPlayer } from './audioPlayer/audioPlayer'

import { PrFetch } from 'pr-fetch'
import { ScriptTag, AudioTag, VideoTag } from './demuxer/type'

interface CutOption {
  sx?: number
  sy?: number
  sw?: number
  sh?: number
}

interface CutVideoPlayerWorkers {
  options: CutOption
  worker: VideoPlayerWorker
}

type CutVideoPlayerWorkersMap = Map<string, CutVideoPlayerWorkers>

const renderCut = async (cutVideoPlayerWorkers: CutVideoPlayerWorkersMap, frame: { bitmap: ImageBitmap; timestamp: number }) => {
  const keys = [...cutVideoPlayerWorkers.keys()]
  const { timestamp, bitmap } = frame

  for (const key of keys) {
    const cut = cutVideoPlayerWorkers.get(key)
    if (!cut) continue

    const { options, worker } = cut
    const { sx = 0, sy = 0, sw = bitmap.width, sh = bitmap.height } = options
    const cutBitmap = await createImageBitmap(bitmap, sx, sy, sw, sh)
    worker.push({ timestamp, bitmap: cutBitmap })
  }
}

const destroyRenderCut = (cutVideoPlayerWorkers: CutVideoPlayerWorkersMap) => {
  const keys = [...cutVideoPlayerWorkers.keys()]
  for (const key of keys) {
    cutVideoPlayerWorkers.get(key)?.worker.destroy()
    cutVideoPlayerWorkers.delete(key)
  }
}

interface On {
  demuxer: {
    script?: (_tag: ScriptTag) => void
    audio?: (_tag: AudioTag) => void
    video?: (_tag: VideoTag) => void
    sei?: (_payload: Uint8Array) => void
  }
  decoder: {
    audio?: (_AudioData: AudioData) => void
    video?: (_frame: { timestamp: number; bitmap: ImageBitmap }) => void
  }
  video?: (canvas: HTMLCanvasElement) => void
  cut?: (key: string, canvas: HTMLCanvasElement) => void
  error?: (_e: any) => void
}

export class PrPlayer {
  private prFetch = new PrFetch()

  private demuxerWorker: DemuxerWorker | undefined
  private decoderWorker: DecoderWorker | undefined

  private audioPlayer: AudioPlayer | undefined
  private videoPlayerWorker: VideoPlayerWorker | undefined

  private renderBaseTime = 0

  private cutVideoPlayerWorkers: CutVideoPlayerWorkersMap = new Map()

  private canvas: HTMLCanvasElement | undefined

  public on: On = { demuxer: {}, decoder: {} }

  constructor() {}

  /**
   * 初始化
   */
  init = () => {
    this.stop()
    this.initDemuxer()
    this.initDecoder()
    this.renderBaseTime = new Date().getTime()
    this.audioPlayer = new AudioPlayer()
    this.audioPlayer.init()
  }

  /**
   * 开始播放
   * @param url : string
   */
  start = async (url: string) => {
    try {
      const res = await this.prFetch.request(url)
      const reader = res.body?.getReader()
      if (!reader) throw new Error('Reader is error.')
      while (true) {
        const { done, value } = await reader.read()
        if (value) {
          this.demuxerWorker?.push(value)
        }

        if (done) {
          break
        }
      }
    } catch (error) {
      // console.log('\x1b[38;2;0;151;255m%c%s\x1b[0m', 'color:#0097ff;', `------->Breathe: error`, error)
    }
  }

  /**
   * 停止
   */
  stop = () => {
    this.prFetch.stop()
    this.demuxerWorker?.destroy()
    this.decoderWorker?.destroy()
    this.videoPlayerWorker?.destroy()
    destroyRenderCut(this.cutVideoPlayerWorkers)
    this.audioPlayer?.destroy()
    this.renderBaseTime = 0
    this.canvas = undefined
  }

  /**
   * 监听媒体 tag
   */
  private onTag = (e: any) => {
    if (!this.decoderWorker) return
    const { header, body } = e
    const { tagType, timestamp } = header
    // console.log('\x1b[38;2;0;151;255m%c%s\x1b[0m', 'color:#0097ff;', `------->Breathe: ${tagType}`, e)
    switch (tagType) {
      case 'script':
        {
          const { width, height } = body
          this.initRender({ width, height })
          this.on.demuxer.script && this.on.demuxer.script(e)
        }
        break
      case 'audio':
        {
          const { accPacketType, data } = body

          // 初始化解码器
          if (accPacketType === 0) {
            const { codec, sampleRate, channelConfiguration } = body
            const config: AudioDecoderConfig = { codec, sampleRate, numberOfChannels: channelConfiguration, description: new Uint8Array([]) }
            this.decoderWorker.audio.init(config)
          }
          // 解码
          else if (accPacketType === 1) {
            const type = 'key'
            this.decoderWorker.audio.decode({ type, timestamp: timestamp * 1, data })
          }
          this.on.demuxer.audio && this.on.demuxer.audio(e)
        }
        break
      case 'video':
        {
          const { avcPacketType, frameType, data, nalus = [] } = body

          // 初始化解码器
          if (avcPacketType === 0) {
            const { codec, data: description } = body
            this.decoderWorker.video.init({ codec, description })
          }
          // 解码
          else if (avcPacketType === 1) {
            const type = frameType === 1 ? 'key' : 'delta'
            this.decoderWorker.video.decode({ type, timestamp: timestamp * 1000, data })

            for (const nalu of nalus) {
              const { header, payload } = nalu
              const { nal_unit_type } = header
              // 解析SEI
              if (nal_unit_type === 6) {
                this.on.demuxer.sei && this.on.demuxer.sei(payload)
              }
            }
          }
          this.on.demuxer.video && this.on.demuxer.video(e)
        }
        break
    }
  }

  /**
   * 初始化分离器
   */
  private initDemuxer = () => {
    this.demuxerWorker = new DemuxerWorker()
    this.demuxerWorker.init()
    this.demuxerWorker.on.tag = this.onTag
  }

  /**
   * 初始化解码器
   */
  private initDecoder = () => {
    this.decoderWorker = new DecoderWorker()
    this.decoderWorker.on.audio.decode = (audioData) => {
      this.audioPlayer?.push(audioData)
      this.on.decoder.audio && this.on.decoder.audio(audioData)
    }
    this.decoderWorker.on.audio.error = (e) => {
      this.stop()
      this.on.error && this.on.error(e)
    }

    this.decoderWorker.on.video.decode = (frame) => {
      this.videoPlayerWorker?.push(frame)
      renderCut(this.cutVideoPlayerWorkers, frame)
      this.on.decoder.video && this.on.decoder.video(frame)
      frame.bitmap.close()
    }
    this.decoderWorker.on.video.error = (e) => {
      this.stop()
      this.on.error && this.on.error(e)
    }
  }

  /**
   * 初始化渲染器
   */
  private initRender = ({ width = 256, height = 256 } = {}) => {
    if (!this.on.video) return
    this.canvas = document.createElement('canvas')
    this.canvas.width = width
    this.canvas.height = height

    const offscreenCanvas = this.canvas.transferControlToOffscreen()

    this.videoPlayerWorker = new VideoPlayerWorker()
    this.videoPlayerWorker.init({ offscreenCanvas, baseTime: this.renderBaseTime })
    this.on.video(this.canvas)
  }

  audio = {
    /**
     * 是否静音 默认为true
     * @param state?: boolean
     */
    setMute: (state?: boolean) => this.audioPlayer?.prAudioStream?.setMute(state)
  }

  video = {
    /**
     * 创建剪切
     */
    createCut: (key: string, cutOption: { sx?: number; sy?: number; sw?: number; sh?: number }) => {
      if (this.cutVideoPlayerWorkers.has(key)) {
        this.cutVideoPlayerWorkers.get(key)?.worker.destroy()
      }

      const canvas = document.createElement('canvas')

      const { sw, sh } = cutOption
      canvas.width = sw || canvas.width
      canvas.height = sh || canvas.height

      const cutWorker = new VideoPlayerWorker()

      const offscreenCanvas = canvas.transferControlToOffscreen()

      cutWorker.init({ offscreenCanvas, baseTime: this.renderBaseTime })

      cutWorker.setCut(cutOption)

      this.cutVideoPlayerWorkers.set(key, { options: cutOption, worker: cutWorker })

      this.on.cut && this.on.cut(key, canvas)
    }
  }
}
