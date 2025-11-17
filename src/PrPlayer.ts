import { DemuxerWorker } from './demuxer/DemuxerWorker'
import { DecoderWorker } from './decoder/DecoderWorker'
import { RenderWorker } from './render/RenderWorker'
import { AudioPlayer } from './audioPlayer/audioPlayer'

import { getFormatFromUrlPattern, stopStream, createStreamGenerator } from './tools'
import { PrResolves } from './PrResolves'
import { parseNalu } from './demuxer/264Parser'
import { PrFetch } from 'pr-fetch'
import { Pattern } from './type'

interface On {
  demuxer: {
    info?: (_info: any) => void
    config?: (_config: any) => void
    chunk?: (_chunk: any) => void
    sei?: (_payload: Uint8Array) => void
  }
  decoder: {
    audio?: (_audio: { audioData: AudioData; playbackRate?: number }) => void
    video?: (_frame: { timestamp: number; bitmap: ImageBitmap }) => void
  }
  error?: (_e: any) => void
}

interface PrPlayerOption {
  debug?: boolean
  frameTrack?: boolean
}

export class PrPlayer {
  private option: PrPlayerOption = {
    debug: false,
    frameTrack: false
  }

  private prFetch = new PrFetch()
  private prResolves = new PrResolves()

  private url: string = ''

  private demuxerWorker: DemuxerWorker | undefined
  private decoderWorker: DecoderWorker | undefined

  private audioPlayer: AudioPlayer | undefined

  private renderWorker: RenderWorker | undefined

  private stream: MediaStream | undefined

  public on: On = { demuxer: {}, decoder: {} }

  private cutRenders: Map<string, { worker: RenderWorker; stream: MediaStream; destroy: Function }> = new Map()

  // @ts-ignore
  trackGenerator: MediaStreamTrackGenerator

  constructor(option: PrPlayerOption = {}) {
    const { debug = false } = option
    this.option.debug = debug
  }

  /**
   * 开始播放
   * @param url : string
   */
  start = async (url: string) => {
    this.stop()
    this.url = url

    const pattern = getFormatFromUrlPattern(url)
    if (pattern === 'unknown') throw new Error('This address cannot be parsed.')
    this.init(pattern)
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
      console.log('\x1b[38;2;0;151;255m%c%s\x1b[0m', 'color:#0097ff;', `------->pr-player: error`, error)
    }
    this.demuxerWorker?.destroy()
    this.decoderWorker?.destroy()
    this.renderWorker?.destroy()
    const keys = [...this.cutRenders.keys()]
    for (const key of keys) {
      this.cutRenders.get(key)?.worker.destroy()
      this.cutRenders.delete(key)
    }
    stopStream(this.stream)
    this.audioPlayer?.destroy()
  }

  /**
   * 获取媒体流
   */
  getStream = () => this.stream

  /**
   * 设置暂停
   * @param pause: boolean
   */
  setPause = (pause: boolean) => {
    this.renderWorker?.setPause(pause)
  }

  /**
   * 是否静音 默认为true
   * @param state?: boolean
   */
  setMute = (state?: boolean) => this.audioPlayer?.prAudioStream?.setMute(state)

  /**
   * 是否开启追帧
   * @param frameTrack?: boolean
   */
  setFrameTrack = (frameTrack: boolean) => {
    this.decoderWorker?.setFrameTrack(frameTrack)
  }

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
      renderIns = createStreamGenerator()
      renderIns.worker.setCut(cutOption)
      this.cutRenders.set(key, renderIns)
      return renderIns
    },

    /**
     * 获取媒体流
     */
    getStream: (key: string) => this.cutRenders.get(key)?.stream,

    /**
     * 设置暂停
     * @param pause: boolean
     */
    setPause: (key: string, pause: boolean) => {
      this.cutRenders.get(key)?.worker.setPause(pause)
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
   * 初始化
   */
  private init = (pattern: Pattern) => {
    this.initDecoder(pattern)
    this.initRender()
    this.initDemuxer(pattern)
    this.audioPlayer = new AudioPlayer()
    this.audioPlayer.init()
  }

  /**
   * 初始化解复器
   */
  private initDemuxer = (pattern: Pattern) => {
    this.demuxerWorker = new DemuxerWorker()
    this.demuxerWorker.init(pattern)

    this.demuxerWorker.on.debug = (debug) => {
      if (this.option.debug) {
        console.log('\x1b[38;2;0;151;255m%c%s\x1b[0m', 'color:#0097ff;', `------->pr-player: debug`, debug)
      }
    }

    this.demuxerWorker.on.info = (info) => {
      if (this.option.debug) {
        console.log('\x1b[38;2;0;151;255m%c%s\x1b[0m', 'color:#0097ff;', `------->pr-player: info`, info)
      }
      this.on.demuxer.info && this.on.demuxer.info(info)
    }

    this.demuxerWorker.on.config = (config) => {
      if (this.option.debug) {
        console.log('\x1b[38;2;0;151;255m%c%s\x1b[0m', 'color:#0097ff;', `------->pr-player: config`, config)
      }
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
      if (!this.decoderWorker) return
      const { kind } = chunk

      switch (kind) {
        case 'audio':
          {
            const { type, dts, data } = chunk
            const timestamp = dts * 1
            this.decoderWorker.audio.push({ type, timestamp, data })
          }
          break
        case 'video':
          {
            const { type, dts, data, nalus = [] } = chunk

            const timestamp = dts * 1000
            this.decoderWorker.video.push({ type, timestamp, data })
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
  private initDecoder = (pattern: Pattern) => {
    this.decoderWorker = new DecoderWorker()
    this.decoderWorker.init(pattern)

    this.decoderWorker.on.audio.decode = (audio) => {
      this.audioPlayer?.push(audio)
      this.on.decoder.audio && this.on.decoder.audio(audio)
    }
    this.decoderWorker.on.audio.error = (e) => {
      if (this.option.debug) {
        console.log('\x1b[38;2;0;151;255m%c%s\x1b[0m', 'color:#0097ff;', `------->pr-player: audio.error `, e)
      }
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
    const { worker, stream } = createStreamGenerator()
    this.renderWorker = worker
    this.stream = stream
    this.renderWorker.setPause(false)
  }

  private flv = {
    start: async () => {
      try {
        let res = await this.prFetch.request(this.url)
        if (res.status !== 200) {
          await new Promise((resolve) => setTimeout(() => resolve(true), 500))
          res = await this.prFetch.request(this.url)
        }
        if (res.status !== 200) {
          await new Promise((resolve) => setTimeout(() => resolve(true), 500))
          res = await this.prFetch.request(this.url)
        }
        if (res.status !== 200) throw new Error('request is error.')

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
        this.on.error && this.on.error(error)
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
      try {
        const prFetch = new PrFetch()
        let res = await prFetch.request(this.url)
        if (res.status !== 200) {
          await new Promise((resolve) => setTimeout(() => resolve(true), 500))
          res = await prFetch.request(this.url)
        }
        if (res.status !== 200) {
          await new Promise((resolve) => setTimeout(() => resolve(true), 500))
          res = await prFetch.request(this.url)
        }
        if (res.status !== 200) throw new Error('request is error.')
        const reader = res.body?.getReader()
        if (!reader) throw new Error('reader is error.')
        while (true) {
          const { done, value } = await reader.read()
          if (value) {
            const info = await this.hls.parse(value)
            const { segments = [], isLive = false } = info
            this.hls.isLive = isLive
            // 非在线视频强制关闭追帧
            if (isLive === false) {
              this.option.frameTrack = false
            }
            let urls = Array.from(segments, (item: any) => item.url)
            const index = urls.findIndex((url) => url === this.hls.url)
            if (index !== -1) {
              urls = urls.slice(index + 1)
            }
            this.hls.urls = urls
          }
          if (done) break // 读取完成
        }
      } catch (error) {
        this.on.error && this.on.error(error)
      }
    },

    start: async () => {
      try {
        await this.hls.getSegments()
        this.hls.getSegmentsTimer = window.setInterval(this.hls.getSegments, 500)
        if (this.hls.isLive === false) {
          clearInterval(this.hls.getSegmentsTimer)
          this.decoderWorker?.setFrameTrack(false) // 关闭追帧
        }

        while (true) {
          const url = this.hls.urls.shift()
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
          } else {
            await new Promise((resolve) => setTimeout(() => resolve(true), 300))
          }
        }
      } catch (error: any) {
        if (error?.name !== 'AbortError') throw Error(error)
      }
    }
  }
}
