import { DemuxerWorker } from './demuxer/DemuxerWorker'
import { DecoderWorker } from './decoder/DecoderWorker'
import { RenderWorker } from './render/RenderWorker'
import { AudioPlayer } from './audioPlayer/audioPlayer'

import { Shader } from './render/type'
import { getFormatFromUrlPattern, stopStream, createRender } from './tools'
import { PrResolves } from './PrResolves'
import { parseNalu } from './demuxer/264Parser'
import { PrFetch } from 'pr-fetch'

interface On {
  demuxer: {
    info?: (_info: any) => void
    config?: (_config: any) => void
    chunk?: (_chunk: any) => void
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
  private prResolves = new PrResolves()

  private url: string = ''

  private demuxerWorker: DemuxerWorker | undefined
  private decoderWorker: DecoderWorker | undefined

  private audioPlayer: AudioPlayer | undefined

  private renderWorker: RenderWorker | undefined

  private renderBaseTime: number | undefined

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
    this.url = url
    this.init()

    const pattern = getFormatFromUrlPattern(url)
    if (pattern === 'unknown') throw new Error('This address cannot be parsed.')
    this.initDemuxer(pattern)

    switch (pattern) {
      case 'flv':
        {
          this.flv.start()
        }
        break
      case 'hls':
        {
          this.hls.start()
        }
        break
    }
  }

  /**
   * 停止
   */
  stop = async () => {
    try {
      clearInterval(this.hls.getSegmentsTimer)
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
    this.renderBaseTime = undefined

    this.canvas = undefined
  }

  getCanvas = () => this.canvas
  getStream = () => this.stream

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

  /**
   * 是否已准备好
   */
  isReady = () => {
    const fun = () => this.stream?.active === true
    return this.prResolves.add('isReady', fun)
  }

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

      renderIns = createRender()
      renderIns.worker.setBaseTime(this.renderBaseTime || 0)
      renderIns.worker.setCut(cutOption)
      this.cutRenders.set(key, renderIns)
      return renderIns
    },

    getCanvas: (key: string) => this.cutRenders.get(key)?.canvas,
    getStream: (key: string) => this.cutRenders.get(key)?.stream,

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

  /**
   * 初始化解复器
   */
  private initDemuxer = (pattern: any) => {
    this.demuxerWorker = new DemuxerWorker()
    this.demuxerWorker.init(pattern)

    this.demuxerWorker.on.debug = (_debug) => {
      // console.log('\x1b[38;2;0;151;255m%c%s\x1b[0m', 'color:#0097ff;', `------->Breathe: debug`, debug)
    }

    this.demuxerWorker.on.info = (info) => {
      // console.log('\x1b[38;2;0;151;255m%c%s\x1b[0m', 'color:#0097ff;', `------->Breathe: info`, info)
      this.on.demuxer.info && this.on.demuxer.info(info)
    }

    this.demuxerWorker.on.config = (config) => {
      // console.log('\x1b[38;2;0;151;255m%c%s\x1b[0m', 'color:#0097ff;', `------->Breathe: config`, config)
      this.on.demuxer.config && this.on.demuxer.config(config)
      const { kind } = config

      switch (kind) {
        case 'audio':
          {
            const { codec, sampleRate, numberOfChannels } = config
            this.decoderWorker?.audio.init({ codec, sampleRate, numberOfChannels })
          }
          break
        case 'video':
          {
            const { codec, description } = config
            this.decoderWorker?.video.init({ codec, description })
          }
          break
      }
    }

    this.demuxerWorker.on.chunk = (chunk) => {
      this.on.demuxer.chunk && this.on.demuxer.chunk(chunk)
      // console.log('\x1b[38;2;0;151;255m%c%s\x1b[0m', 'color:#0097ff;', `------->Breathe: chunk`, chunk)
      if (!this.decoderWorker) return
      const { kind } = chunk

      switch (kind) {
        case 'audio':
          {
            // console.log('\x1b[38;2;0;151;255m%c%s\x1b[0m', 'color:#0097ff;', `------->Breathe: chunk`, chunk)
            const { type, dts, data } = chunk
            const timestamp = dts * 1
            this.decoderWorker.audio.decode({ type, timestamp, data })
          }
          break
        case 'video':
          {
            // console.log('\x1b[38;2;0;151;255m%c%s\x1b[0m', 'color:#0097ff;', `------->Breathe: chunk`, chunk)
            const { type, dts, data, nalus = [] } = chunk
            // 暂存开始时间 ms
            if (this.renderBaseTime === undefined) {
              const now = new Date().getTime()
              this.renderBaseTime = now - dts // 设置渲染基准时间
              this.renderWorker?.setBaseTime(this.renderBaseTime)
            }

            const timestamp = dts * 1000
            this.decoderWorker.video.decode({ type, timestamp, data })
            for (const nalu of nalus) {
              if (nalu.byteLength <= 4) continue
              const { header, data } = parseNalu(nalu)
              const { nal_unit_type } = header
              // 解析SEI
              if (nal_unit_type === 6) {
                this.on.demuxer.sei && this.on.demuxer.sei(data)
              }
            }
          }
          break
      }
    }
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
    const { worker, canvas, stream } = createRender()

    this.renderWorker = worker

    this.canvas = canvas

    this.stream = stream

    this.renderWorker.setPause(false)
  }

  private flv = {
    start: async () => {
      try {
        const res = await this.prFetch.request(this.url)
        const reader = res.body?.getReader()
        if (!reader) throw new Error('reader is error.')
        while (true) {
          const { done, value } = await reader.read()
          if (value) {
            this.demuxerWorker?.push(value)
          }
          if (done) break // 读取完成
        }
      } catch (error: any) {
        if (error?.name !== 'AbortError') throw Error(error)
      }
    }
  }

  private hls = {
    isLive: false,
    urls: [] as string[],
    url: '',
    getSegmentsTimer: 0,
    parse: async (value: AllowSharedBufferSource) => {
      const textDecoder = new TextDecoder('utf-8') // 指定编码格式
      const playlistText = textDecoder.decode(value)

      const lines = playlistText.split('\n').map((item) => item.replace('\r', ''))

      const baseUrl = this.url.substring(0, this.url.lastIndexOf('/') + 1)
      let duration = 4 // 默认片段时长
      let targetDuration = 0
      let isLive = false
      const segments = []

      for (const line of lines) {
        if (line.startsWith('#EXTINF:')) {
          duration = parseFloat(line.split(':')[1].split(',')[0])
        } else if (line.startsWith('#EXT-X-TARGETDURATION:')) {
          targetDuration = parseInt(line.split(':')[1])
        } else if (line.startsWith('#EXT-X-ENDLIST')) {
          isLive = false // 点播流
        } else if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
          isLive = true // 直播流
        } else if (line.includes('.ts') && !line.startsWith('#')) {
          segments.push({
            url: line.startsWith('http') ? line : baseUrl + line,
            duration,
            isLive
          })
        }
      }
      return { baseUrl, targetDuration, isLive, segments }
    },
    getSegments: async () => {
      const prFetch = new PrFetch()
      const res = await prFetch.request(this.url)
      const reader = res.body?.getReader()
      if (!reader) throw new Error('reader is error.')
      while (true) {
        const { done, value } = await reader.read()
        if (value) {
          const info = await this.hls.parse(value)
          const { segments = [], isLive = false } = info
          this.hls.isLive = isLive
          let urls = Array.from(segments, (item: any) => item.url)
          const index = urls.findIndex((url) => url === this.hls.url)
          if (index !== -1) {
            urls = urls.slice(index + 1)
          }
          this.hls.urls = urls
        }
        if (done) break // 读取完成
      }
    },

    getData: async () => {},
    start: async () => {
      try {
        await this.hls.getSegments()
        this.hls.getSegmentsTimer = window.setInterval(this.hls.getSegments, 1000)
        if (this.hls.isLive === false) {
          clearInterval(this.hls.getSegmentsTimer)
        }

        while (true) {
          const url = this.hls.urls.shift()
          // console.log('\x1b[38;2;0;151;255m%c%s\x1b[0m', 'color:#0097ff;', `------->Breathe: url`, url?.slice(97 + 24))
          if (url) {
            this.hls.url = url
            const res = await this.prFetch.request(url)
            const reader = res.body?.getReader()
            if (!reader) throw new Error('segment reader is error.')

            while (true) {
              const { done, value } = await reader.read()
              if (value) {
                this.demuxerWorker?.push(value)
              }
              if (done) break // 读取完成
            }
          }
          await new Promise((resolve) => setTimeout(() => resolve(true), 500))
        }
      } catch (error: any) {
        if (error?.name !== 'AbortError') throw Error(error)
      }
    }
  }
}
