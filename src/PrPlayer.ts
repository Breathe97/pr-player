import { DemuxerWorker } from './demuxer/DemuxerWorker'
import { DecoderWorker } from './decoder/DecoderWorker'
import { VideoPlayerWorker } from './videoPlayer/VideoPlayerWorker'
import { AudioPlayer } from './audioPlayer/audioPlayer'

import { PrFetch } from 'pr-fetch'
import { ScriptTag, AudioTag, VideoTag } from './demuxer/type'

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
  stream?: (_stream: MediaStream) => void
  cutStream?: (_key: string, _stream: MediaStream) => void
}

export class PrPlayer {
  private prFetch = new PrFetch()

  private demuxerWorker = new DemuxerWorker()
  private decoderWorker = new DecoderWorker()

  private audioPlayer = new AudioPlayer()
  private videoPlayerWorker = new VideoPlayerWorker()

  private renderBaseTime = 0

  private cutVideoPlayerWorkers = new Map()

  private canvas: HTMLCanvasElement | undefined

  public on: On = { demuxer: {}, decoder: {} }

  constructor() {
    this.decoderWorker.on.audio.decode = (e) => {
      this.audioPlayer.push(e)
      this.on.decoder.audio && this.on.decoder.audio(e)
    }
    this.decoderWorker.on.audio.error = (e) => {
      console.log('\x1b[38;2;0;151;255m%c%s\x1b[0m', 'color:#0097ff;', `------->decoderWorker.audio.onError: e`, e)
      this.stop()
    }

    this.decoderWorker.on.video.decode = (e) => {
      this.videoPlayerWorker.push(e)
      const keys = [...this.cutVideoPlayerWorkers.keys()]
      for (const key of keys) {
        this.cutVideoPlayerWorkers.get(key).push(e)
      }
      this.on.decoder.video && this.on.decoder.video(e)
    }
    this.decoderWorker.on.video.error = (e) => {
      console.log('\x1b[38;2;0;151;255m%c%s\x1b[0m', 'color:#0097ff;', `------->decoderWorker.video.onError: e`, e)
      this.stop()
    }
  }

  /**
   * 创建剪切
   */
  createCut = (key: string, cutOption: { sx?: number; sy?: number; sw?: number; sh?: number }, canvas?: HTMLCanvasElement, fps = 25) => {
    if (!canvas) {
      canvas = document.createElement('canvas')
    }

    if (this.cutVideoPlayerWorkers.has(key)) {
      this.cutVideoPlayerWorkers.get(key).destroy()
    }

    const { sw, sh } = cutOption
    canvas.width = sw || canvas.width
    canvas.height = sh || canvas.height

    const renderWorker = new VideoPlayerWorker()

    const offscreenCanvas = canvas.transferControlToOffscreen()

    renderWorker.init({ offscreenCanvas, baseTime: this.renderBaseTime })
    renderWorker.setCut(cutOption)

    this.cutVideoPlayerWorkers.set(key, renderWorker)

    if (this.on.cutStream) {
      const stream = canvas.captureStream(fps)
      this.on.cutStream(key, stream)
    }
    return canvas
  }

  /**
   * 初始化
   * @param canvas?: HTMLCanvasElement
   */
  init = (canvas?: HTMLCanvasElement) => {
    this.stop()
    this.initDemuxer()
    if (!canvas) {
      canvas = document.createElement('canvas')
    }

    this.canvas = canvas

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
          this.demuxerWorker.push(value)
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
    this.demuxerWorker.destroy()
    this.decoderWorker.audio.destroy()
    this.decoderWorker.video.destroy()
    this.videoPlayerWorker.destroy()
    const keys = [...this.cutVideoPlayerWorkers.keys()]
    for (const key of keys) {
      this.cutVideoPlayerWorkers.get(key).destroy()
      this.cutVideoPlayerWorkers.delete(key)
    }
    this.audioPlayer.destroy()
    this.renderBaseTime = 0
    this.canvas = undefined
  }

  /**
   * 是否静音 默认为true
   * @param state?: boolean
   */
  setMute = (state?: boolean) => this.audioPlayer.prAudioStream?.setMute(state)

  /**
   * 监听媒体 tag
   */
  private onTag = (e: any) => {
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
    this.demuxerWorker.init()
    this.demuxerWorker.on.tag = this.onTag
  }

  /**
   * 初始化渲染器
   */
  private initRender = ({ width = 256, height = 256, fps = 25 } = {}) => {
    if (!this.canvas) return
    this.canvas.width = width
    this.canvas.height = height
    this.renderBaseTime = new Date().getTime() + 1000 * 3

    const offscreenCanvas = this.canvas.transferControlToOffscreen()
    this.videoPlayerWorker.init({ offscreenCanvas, baseTime: this.renderBaseTime })

    if (this.on.stream) {
      const stream = new MediaStream()

      const audioStream = this.audioPlayer.getStream()

      const videoStream = this.canvas?.captureStream(fps)

      {
        const [track] = audioStream?.getAudioTracks() || []
        track && stream.addTrack(track)
      }

      {
        const [track] = videoStream.getVideoTracks() || []
        track && stream.addTrack(track)
      }

      this.on.stream(stream)
    }
  }
}
