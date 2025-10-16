import { DemuxerWorker } from './demuxer/DemuxerWorker'
import { DecoderWorker } from './decoder/DecoderWorker'
import { RenderWorker } from './render/RenderWorker'
import { AudioPlayer } from './audioPlayer/audioPlayer'

import { PrFetch } from 'pr-fetch'
import { ScriptTag, AudioTag, VideoTag } from './demuxer/type'
import { Shader } from './render/type'

const stopStream = (stream: MediaStream | undefined) => {
  const tracks = stream?.getTracks() || []
  for (const track of tracks) {
    track.stop()
  }
}

const createRender = (baseTime: number) => {
  const worker = new RenderWorker()

  const canvas = document.createElement('canvas')
  const offscreenCanvas = canvas.transferControlToOffscreen()

  // @ts-ignore
  const trackGenerator = new MediaStreamTrackGenerator({ kind: 'video' })

  const stream = new MediaStream([trackGenerator])

  const destroy = () => {
    worker.destroy()
    stopStream(stream)
  }

  worker.init({ offscreenCanvas, baseTime, writable: trackGenerator.writable })

  return { worker, canvas, stream, destroy }
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
  error?: (_e: any) => void
}

export class PrPlayer {
  private prFetch = new PrFetch()

  private demuxerWorker: DemuxerWorker | undefined
  private decoderWorker: DecoderWorker | undefined

  private audioPlayer: AudioPlayer | undefined

  private renderWorker: RenderWorker | undefined

  private renderBaseTime = 0

  private stream: MediaStream | undefined

  private canvas: HTMLCanvasElement | undefined

  public on: On = { demuxer: {}, decoder: {} }

  private cutRenders: Map<string, { worker: RenderWorker; stream: MediaStream; canvas: HTMLCanvasElement; destroy: Function }> = new Map()

  // @ts-ignore
  trackGenerator: MediaStreamTrackGenerator

  constructor() {}

  /**
   * 初始化
   */
  init = () => {
    this.initDemuxer()
    this.initDecoder()
    this.audioPlayer = new AudioPlayer()
    this.audioPlayer.init()
    this.initRender()
  }

  /**
   * 开始播放
   * @param url : string
   */
  start = async (url: string) => {
    this.stop()
    this.renderBaseTime = new Date().getTime()
    this.init()
    return this.prFetch
      .request(url)
      .then(async (res) => {
        const reader = res.body?.getReader()
        if (!reader) throw new Error('Reader is error.')

        const readFunc = () =>
          reader
            .read()
            .then(({ done, value }) => {
              if (value) {
                this.demuxerWorker?.push(value)
              }
              if (done) return
              readFunc()
            })
            .catch((err) => {
              if (err.name !== 'AbortError') throw err
            })
        readFunc()
      })
      .catch((err) => {
        console.log('\x1b[38;2;0;151;255m%c%s\x1b[0m', 'color:#0097ff;', `------->Breathe: err`, err)
      })
  }

  /**
   * 停止
   */
  stop = async () => {
    try {
      this.prFetch.stop()
    } catch (error) {
      console.log('\x1b[38;2;0;151;255m%c%s\x1b[0m', 'color:#0097ff;', `------->Breathe: error`, error)
    }
    this.demuxerWorker?.destroy()
    this.decoderWorker?.destroy()
    this.renderWorker?.destroy()
    stopStream(this.stream)
    const keys = [...this.cutRenders.keys()]
    for (const key of keys) {
      this.cut.remove(key)
    }
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
          this.renderWorker?.setSize({ width, height })
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

    this.decoderWorker.on.video.decode = async (frame) => {
      this.renderWorker?.push(frame)
      const keys = [...this.cutRenders.keys()]
      for (const key of keys) {
        this.cutRenders.get(key)?.worker.push(frame)
      }
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
  private initRender = () => {
    const { worker, canvas, stream } = createRender(this.renderBaseTime)

    this.renderWorker = worker

    this.canvas = canvas

    this.stream = stream

    this.renderWorker.setPause(false)
  }

  getCanvas = () => this.canvas
  getStream = () => this.stream
  getCutCanvas = (key: string) => this.cutRenders.get(key)?.canvas
  getCutStream = (key: string) => this.cutRenders.get(key)?.stream

  setPause = (pause: boolean) => {
    this.renderWorker?.setPause(pause)
  }

  /**
   * 设置渲染模式
   */
  setShader = (shader: Shader[]) => {
    this.renderWorker?.setShader(shader)
  }

  /**
   * 是否静音 默认为true
   * @param state?: boolean
   */
  setMute = (state?: boolean) => this.audioPlayer?.prAudioStream?.setMute(state)

  cut = {
    /**
     * 创建剪切
     */
    create: (key: string, cutOption: { sx: number; sy: number; sw: number; sh: number }) => {
      let renderIns = this.cutRenders.get(key)
      if (renderIns) {
        renderIns.worker.setCut(cutOption)
        renderIns.worker.setPause(false)
        return renderIns
      }

      renderIns = createRender(this.renderBaseTime)
      renderIns.worker.setCut(cutOption)
      this.cutRenders.set(key, renderIns)
      return renderIns
    },
    setPause: (key: string, pause: boolean) => {
      this.cutRenders.get(key)?.worker.setPause(pause)
    },
    /**
     * 设置渲染模式
     */
    setShader: (key: string, shader: Shader[]) => {
      this.cutRenders.get(key)?.worker.setShader(shader)
    },
    /**
     * 移除剪切
     */
    remove: (key: string) => {
      this.cutRenders.get(key)?.destroy()
      this.cutRenders.delete(key)
    }
  }
}
