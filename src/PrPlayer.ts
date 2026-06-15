import { DemuxerWorker } from './demuxer/DemuxerWorker'
import { DecoderWorker } from './decoder/DecoderWorker'
import { RenderWorker } from './render/RenderWorker'
import { AudioPlayer } from './audioPlayer/audioPlayer'

import { getFormatFromUrlPattern, stopStream } from './tools'
import { PrResolves } from './PrResolves'
import { parseNalu } from './demuxer/parsers/264Parser'
import { buildSegmentUrl, parseMpd, resolveUrl, type MpdAdaptation, type MpdInfo } from './demuxer/parsers/mpdParser'
import { prPlayerDebug } from './debug/PrPlayerDebug'
import { PrFetch } from 'pr-fetch'
import type { Pattern } from './type'

interface PrPlayerDash {
  isLive: boolean
  segmentNumber: number
  mpdInfo: MpdInfo | null
  getSegmentsTimer: number
  fetchSegment: (url: string) => Promise<boolean>
  fetchByteRange: (url: string, start: number, end: number) => Promise<boolean>
  getMpd: () => Promise<MpdInfo | null>
  start: () => Promise<unknown>
}

interface On {
  demuxer: {
    info?: (_info: any) => void
    config?: (_config: any) => void
    chunk?: (_chunk: any) => void
  }
  decoder: {
    audio?: (_audio: { audioData: AudioData; playbackRate?: number }) => void
    video?: (_frame: { timestamp: number; frame: VideoFrame }) => void
    sei?: (_payload: Uint8Array) => void
    analysis?: (_e: any) => void
  }
  debug?: (_e: any) => void
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

  private converter: 'generator' | 'canvas' = 'MediaStreamTrackGenerator' in window ? 'generator' : 'canvas' // 自动检测浏览器 使用哪一种模式转换生产视频流

  private prFetch = new PrFetch()
  private getSegmentsFetch = new PrFetch()

  private prResolves = new PrResolves()

  private url: string = ''
  private start_resolve?: Function

  private demuxerWorker: DemuxerWorker | undefined
  private decoderWorker: DecoderWorker | undefined

  public audioPlayer: AudioPlayer | undefined

  private renderWorker: RenderWorker | undefined

  private stream: MediaStream | undefined

  public on: On = { demuxer: {}, decoder: {} }

  private cutRenders: Map<string, { stream: MediaStream }> = new Map()

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
    await this.stop()
    this.url = url

    const pattern = getFormatFromUrlPattern(url)
    if (pattern === 'unknown') throw new Error('This address cannot be parsed.')
    prPlayerDebug.setMeta({ url, pattern })
    prPlayerDebug.log('player', 'start', { url, pattern })
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
      case 'dash':
        {
          this.dash.start()
        }
        break
      case 'mp4':
        {
          this.mp4.start()
        }
        break
      case 'rtmp':
        throw new Error('RTMP is not supported in browser. Please use HTTP-FLV or HLS.')
    }
  }

  /**
   * 停止
   */
  stop = async () => {
    try {
      this.url = ''
      clearInterval(this.hls.getSegmentsTimer)
      clearInterval(this.dash.getSegmentsTimer)
      this.prFetch.stop()
      this.getSegmentsFetch.stop()
      this.demuxerWorker?.destroy()
      this.decoderWorker?.destroy()
      this.renderWorker?.destroy()
      this.cutRenders = new Map()
      stopStream(this.stream)
      this.audioPlayer?.destroy()
    } catch (error) {
      console.log('\x1b[38;2;0;151;255m%c%s\x1b[0m', 'color:#0097ff;', `------->pr-player: error`, error)
    }
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
    this.renderWorker?.setPause({ pause })
  }

  /**
   * 是否静音 默认为true
   * @param state?: boolean
   */
  setMute = (state?: boolean) => this.audioPlayer?.prAudioStream?.setMute(state)

  /**
   * 设置输出音量
   * @param gain
   */
  setOutputGain = (gain: number) => {
    this.audioPlayer?.prAudioStream?.setOutputGain(gain)
  }

  /**
   * 是否开启追帧
   * @param frameTrack?: boolean
   */
  setFrameTrack = (frameTrack: boolean) => {
    this.option.frameTrack = frameTrack
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
      if (this.converter === 'generator') {
        // @ts-ignore
        const trackGenerator = new MediaStreamTrackGenerator({ kind: 'video' })
        const stream = new MediaStream([trackGenerator])
        this.renderWorker?.addCut({ key, writable: trackGenerator.writable, option: cutOption })
        this.cutRenders.set(key, { stream })
        return stream
      }

      const canvas = document.createElement('canvas')

      const stream = canvas.captureStream()
      const offscreen = canvas.transferControlToOffscreen()
      this.renderWorker?.addCut({ key, offscreen, option: cutOption })
      this.cutRenders.set(key, { stream })
      return stream
    },

    /**
     * 设置剪切
     */
    setCut: (key: string, cutOption: { sx: number; sy: number; sw: number; sh: number }) => {
      this.renderWorker?.setCut({ key, cutOption })
    },

    /**
     * 获取媒体流
     */
    getStream: (key: string) => this.cutRenders.get(key)?.stream,

    /**
     * 移除剪切
     */
    remove: (key: string) => {
      this.renderWorker?.delCut(key)
      this.cutRenders.delete(key)
    },

    /**
     * 设置暂停
     * @param pause: boolean
     */
    setPause: (key: string, pause: boolean) => {
      this.renderWorker?.setPause({ key, pause })
    }
  }

  /**
   * 初始化
   */
  private init = (pattern: Pattern) => {
    this.initRender()
    this.initDecoder(pattern)
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

    this.demuxerWorker.on.debug = (e) => {
      prPlayerDebug.log('demuxer', 'debug', e)
      prPlayerDebug.bump('demuxerDebug')
      if (this.option.debug) {
        this.on.debug && this.on.debug(e)
      }
    }

    this.demuxerWorker.on.info = (info) => {
      prPlayerDebug.log('demuxer', 'info', info)
      prPlayerDebug.bump('demuxerInfo')
      if (this.option.debug) {
        console.log('\x1b[38;2;0;151;255m%c%s\x1b[0m', 'color:#0097ff;', `------->pr-player: info`, info)
      }
      this.on.demuxer.info && this.on.demuxer.info(info)
    }

    this.demuxerWorker.on.config = (config) => {
      prPlayerDebug.log('demuxer', 'config', config)
      prPlayerDebug.bump('demuxerConfig')
      if (this.option.debug) {
        console.log('\x1b[38;2;0;151;255m%c%s\x1b[0m', 'color:#0097ff;', `------->pr-player: config`, config)
      }
      this.on.demuxer.config && this.on.demuxer.config(config)
      const { kind } = config

      switch (kind) {
        case 'audio':
          {
            const { codec, sampleRate, numberOfChannels, description } = config
            this.decoderWorker?.initAudio({
              codec,
              sampleRate,
              numberOfChannels,
              ...(description ? { description } : {})
            })
          }
          break
        case 'video':
          {
            const { codec, description } = config
            this.decoderWorker?.initVideo({ codec, description })
          }
          break
      }
    }

    this.demuxerWorker.on.chunk = (chunk) => {
      if (chunk.kind === 'video') {
        prPlayerDebug.bump('demuxerChunkVideo')
        if (prPlayerDebug.getCount('demuxerChunkVideo') <= 5) {
          prPlayerDebug.log('demuxer', 'chunk', { kind: chunk.kind, type: chunk.type, dts: chunk.dts, dataLength: chunk.data?.byteLength })
        }
      } else {
        prPlayerDebug.bump('demuxerChunkAudio')
        if (prPlayerDebug.getCount('demuxerChunkAudio') <= 5) {
          prPlayerDebug.log('demuxer', 'chunk', { kind: chunk.kind, type: chunk.type, dts: chunk.dts, dataLength: chunk.data?.byteLength })
        }
      }
      this.on.demuxer.chunk && this.on.demuxer.chunk(chunk)
      if (!this.decoderWorker) return
      const { kind } = chunk

      switch (kind) {
        case 'audio':
          {
            const { type, dts, data } = chunk
            const timestamp = dts * 1000
            this.decoderWorker.push({ kind, init: { type, timestamp, data } })
          }
          break
        case 'video':
          {
            const { type, dts, data, nalus = [] } = chunk
            const timestamp = dts * 1000
            this.decoderWorker.push({ kind, init: { type, timestamp, data }, nalus })
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
    const { frameTrack = false } = this.option
    this.decoderWorker.setFrameTrack(frameTrack)

    this.decoderWorker.on.audio.error = (e) => {
      prPlayerDebug.error('decoder', 'audio.error', e)
      if (this.option.debug) {
        console.log('\x1b[38;2;0;151;255m%c%s\x1b[0m', 'color:#0097ff;', `------->pr-player: audio.error `, e)
      }
      this.on.error && this.on.error(e)
    }

    this.decoderWorker.on.audio.decode = (audio) => {
      prPlayerDebug.bump('decoderAudio')
      if (prPlayerDebug.getCount('decoderAudio') <= 3) {
        prPlayerDebug.log('decoder', 'audio.decode', { playbackRate: audio.playbackRate })
      }
      this.audioPlayer?.push(audio)
      this.on.decoder.audio && this.on.decoder.audio(audio)
    }

    this.decoderWorker.on.video.decode = (frame) => {
      prPlayerDebug.bump('decoderVideo')
      if (prPlayerDebug.getCount('decoderVideo') <= 3) {
        prPlayerDebug.log('decoder', 'video.decode', { timestamp: frame.timestamp })
      }
      if (this.start_resolve) {
        this.start_resolve(true)
        this.start_resolve = undefined
      }
      this.renderWorker?.push(frame)
      this.on.decoder.video && this.on.decoder.video(frame)
    }

    this.decoderWorker.on.video.error = (e) => {
      prPlayerDebug.error('decoder', 'video.error', e)
      if (this.option.debug) {
        console.log('\x1b[38;2;0;151;255m%c%s\x1b[0m', 'color:#0097ff;', `------->pr-player: video.error `, e)
      }
      this.on.error && this.on.error(e)
    }

    this.decoderWorker.on.nalus = async (nalus) => {
      for (const nalu of nalus) {
        if (nalu.byteLength <= 4) continue
        const { header, data } = parseNalu(nalu)
        const { nal_unit_type } = header
        // 解析SEI
        if (nal_unit_type === 6) {
          this.on.decoder.sei && this.on.decoder.sei(data)
        }
      }
    }

    this.decoderWorker.on.analysis = (e) => {
      this.on.decoder.analysis && this.on.decoder.analysis(e)
    }
  }

  /**
   * 初始化渲染器
   */
  private initRender = () => {
    this.renderWorker = new RenderWorker()

    if (this.converter === 'generator') {
      // @ts-ignore
      const trackGenerator = new MediaStreamTrackGenerator({ kind: 'video' })
      const stream = new MediaStream([trackGenerator])
      this.renderWorker?.addCut({ writable: trackGenerator.writable })
      this.stream = stream
    } else {
      const canvas = document.createElement('canvas')
      const stream = canvas.captureStream()
      const offscreen = canvas.transferControlToOffscreen()
      this.renderWorker?.addCut({ offscreen })
      this.stream = stream
    }
    this.renderWorker?.setPause({ pause: false })
  }

  private flv = {
    start: () => {
      return new Promise(async (resolve, reject) => {
        try {
          this.start_resolve = resolve
          let res
          let count = 0
          while (true) {
            count += 1
            try {
              res = await this.prFetch.request(this.url)
            } catch (error) {
              console.log('\x1b[38;2;0;151;255m%c%s\x1b[0m', 'color:#0097ff;', `------->Breathe: error`, error)
            }
            if (res?.status === 200 || count === 3) break
            await new Promise((resolve) => setTimeout(() => resolve(true), 500))
          }

          if (!res || res.status !== 200) return reject('request is error.')

          const reader = res.body?.getReader()
          if (!reader) return reject('reader is error.')

          while (true) {
            const { done, value } = await reader.read()
            if (value) {
              this.demuxerWorker?.push(value)
            }
            if (done || this.url === '') break // 读取完成
          }
        } catch (error: any) {
          if (error.name !== 'AbortError') {
            reject(error)
          }
        }
      })
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
        let res
        let count = 0
        while (true) {
          count += 1
          try {
            res = await this.getSegmentsFetch.request(this.url)
          } catch (error) {
            console.log('\x1b[38;2;0;151;255m%c%s\x1b[0m', 'color:#0097ff;', `------->Breathe: error`, error)
          }
          if (res?.status === 200 || count === 3) break
          await new Promise((resolve) => setTimeout(() => resolve(true), 500))
        }

        if (!res || res.status !== 200) throw new Error('request is error.')

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
          if (done || this.url === '') break // 读取完成
        }
      } catch (error: any) {
        if (error.name !== 'AbortError') {
          this.on.error && this.on.error(error)
        }
      }
    },
    start: () => {
      return new Promise(async (resolve, reject) => {
        try {
          this.start_resolve = resolve
          this.hls.url = ''
          this.hls.urls = []
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
                if (done || this.url === '') break // 读取完成
              }
            } else {
              await new Promise((resolve) => setTimeout(() => resolve(true), 300))
            }
          }
        } catch (error: any) {
          if (error.name !== 'AbortError') {
            reject(error)
          }
        }
      })
    }
  }

  private mp4 = {
    start: () => {
      return new Promise(async (resolve, reject) => {
        try {
          this.start_resolve = resolve
          let res
          let count = 0
          while (true) {
            count += 1
            try {
              res = await this.prFetch.request(this.url)
            } catch (error) {
              console.log('\x1b[38;2;0;151;255m%c%s\x1b[0m', 'color:#0097ff;', `------->Breathe: error`, error)
            }
            if (res?.status === 200 || count === 3) break
            await new Promise((resolve) => setTimeout(() => resolve(true), 500))
          }

          if (!res || res.status !== 200) {
            prPlayerDebug.error('mp4', 'fetch-failed', { status: res?.status, url: this.url })
            return reject('request is error.')
          }

          prPlayerDebug.log('mp4', 'fetch-ok', { status: res.status, url: this.url })
          const reader = res.body?.getReader()
          if (!reader) return reject('reader is error.')

          this.decoderWorker?.setFrameTrack(false)

          let totalBytes = 0
          while (true) {
            const { done, value } = await reader.read()
            if (value) {
              totalBytes += value.byteLength
              prPlayerDebug.bump('pushBytes')
              this.demuxerWorker?.push(value)
            }
            if (done || this.url === '') break
          }
          prPlayerDebug.log('mp4', 'fetch-done', { totalBytes })
        } catch (error: any) {
          if (error.name !== 'AbortError') {
            reject(error)
          }
        }
      })
    }
  }

  private dash: PrPlayerDash = {
    isLive: false,
    segmentNumber: 1,
    mpdInfo: null,
    getSegmentsTimer: 0,
    fetchSegment: async (url: string) => {
      const res = await this.prFetch.request(url)
      if (!res || res.status !== 200) return false
      const reader = res.body?.getReader()
      if (!reader) return false
      while (true) {
        const { done, value } = await reader.read()
        if (value) this.demuxerWorker?.push(value)
        if (done || this.url === '') break
      }
      return true
    },
    fetchByteRange: async (url: string, start: number, end: number) => {
      let res: Response | undefined
      let count = 0
      while (true) {
        count += 1
        try {
          res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } })
        } catch (error) {
          console.log('\x1b[38;2;0;151;255m%c%s\x1b[0m', 'color:#0097ff;', `------->Breathe: error`, error)
        }
        if ((res?.ok && (res.status === 200 || res.status === 206)) || count === 3) break
        await new Promise((resolve) => setTimeout(() => resolve(true), 500))
      }
      if (!res?.ok || (res.status !== 200 && res.status !== 206)) {
        prPlayerDebug.error('dash', 'range-fetch-failed', { url, start, end, status: res?.status })
        return false
      }
      const data = new Uint8Array(await res.arrayBuffer())
      prPlayerDebug.log('dash', 'range-fetch', { url, start, end, bytes: data.byteLength, status: res.status })
      if (data.byteLength > 0) {
        prPlayerDebug.bump('pushBytes')
        this.demuxerWorker?.push(data)
      }
      return data.byteLength > 0
    },
    getMpd: async (): Promise<MpdInfo | null> => {
      try {
        let res
        let count = 0
        while (true) {
          count += 1
          try {
            res = await this.getSegmentsFetch.request(this.url)
          } catch (error) {
            console.log('\x1b[38;2;0;151;255m%c%s\x1b[0m', 'color:#0097ff;', `------->Breathe: error`, error)
          }
          if (res?.status === 200 || count === 3) break
          await new Promise((resolve) => setTimeout(() => resolve(true), 500))
        }

        if (!res || res.status !== 200) throw new Error('request is error.')

        const reader = res.body?.getReader()
        if (!reader) throw new Error('reader is error.')
        const chunks: Uint8Array[] = []
        while (true) {
          const { done, value } = await reader.read()
          if (value) chunks.push(value)
          if (done || this.url === '') break
        }
        const total = chunks.reduce((n, c) => n + c.byteLength, 0)
        const merged = new Uint8Array(total)
        let offset = 0
        for (const c of chunks) {
          merged.set(c, offset)
          offset += c.byteLength
        }
        const xml = new TextDecoder('utf-8').decode(merged)
        const mpdInfo = parseMpd(xml, this.url)
        this.dash.mpdInfo = mpdInfo
        this.dash.isLive = mpdInfo.isLive
        prPlayerDebug.log('dash', 'mpd-parsed', {
          adaptations: mpdInfo.adaptations.map((a) => ({
            kind: a.kind,
            codecs: a.representation.codecs,
            hasSegmentList: !!a.representation.segmentList,
            segmentCount: a.representation.segmentList?.segments.length,
            initRange: a.representation.segmentList?.initRange
          }))
        })
        if (!this.dash.isLive) this.option.frameTrack = false
        return mpdInfo
      } catch (error: any) {
        if (error.name !== 'AbortError') {
          this.on.error && this.on.error(error)
        }
        return null
      }
    },
    start: () => {
      return new Promise(async (resolve, reject) => {
        try {
          this.start_resolve = resolve
          this.dash.segmentNumber = 1
          this.dash.mpdInfo = null
          const info = await this.dash.getMpd()
          if (!info) return reject('mpd parse is error.')

          const dashRep = info.adaptations.find((a) => a.kind === 'video' || a.kind === 'mux')?.representation
          if (dashRep?.width && dashRep?.height) {
            const dashInfo = { width: dashRep.width, height: dashRep.height, duration: info.duration }
            prPlayerDebug.log('dash', 'info', dashInfo)
            this.on.demuxer.info && this.on.demuxer.info(dashInfo)
          }

          const segmentListAdapt = info.adaptations.find((a) => a.representation.segmentList)
          if (segmentListAdapt?.representation.segmentList) {
            const { segmentList, baseUrl: repBaseUrl } = segmentListAdapt.representation
            const mediaUrl = resolveUrl(info.baseUrl, repBaseUrl || '')

            if (segmentList.initRange) {
              const { start, end } = segmentList.initRange
              const ok = await this.dash.fetchByteRange(mediaUrl, start, end)
              if (!ok) return reject('dash init segment fetch failed.')
            }

            this.decoderWorker?.setFrameTrack(false)

            for (const range of segmentList.segments) {
              if (this.url === '') break
              await this.dash.fetchByteRange(mediaUrl, range.start, range.end)
            }
            return
          }

          const video = info.adaptations.find((a) => a.kind === 'video')
          const audio = info.adaptations.find((a) => a.kind === 'audio')
          const mux = info.adaptations.find((a) => a.kind === 'mux')
          const reps = [video, audio, mux].filter((a): a is MpdAdaptation => !!a)
          if (reps.length === 0) return reject('no adaptation in mpd.')
          for (const adapt of reps) {
            const { id, bandwidth, template } = adapt.representation
            if (!template?.initialization) continue
            const initUrl = buildSegmentUrl(info.baseUrl, template.initialization, {
              RepresentationID: id,
              Bandwidth: bandwidth,
              Number: this.dash.segmentNumber
            })
            await this.dash.fetchSegment(initUrl)
          }

          if (this.dash.isLive) {
            this.dash.getSegmentsTimer = window.setInterval(this.dash.getMpd, 3000)
          } else {
            this.decoderWorker?.setFrameTrack(false)
          }

          while (true) {
            const mpd: MpdInfo | null = this.dash.mpdInfo
            if (!mpd || this.url === '') break
            const { baseUrl } = mpd
            let hasSegment = false

            for (const adapt of reps) {
              const { id, bandwidth, template } = adapt.representation
              if (!template?.media) continue
              const mediaUrl = buildSegmentUrl(baseUrl, template.media, {
                RepresentationID: id,
                Bandwidth: bandwidth,
                Number: this.dash.segmentNumber
              })
              const ok = await this.dash.fetchSegment(mediaUrl)
              if (ok) hasSegment = true
            }

            if (!hasSegment) {
              if (this.dash.isLive) {
                await new Promise((resolve) => setTimeout(() => resolve(true), 300))
                continue
              }
              break
            }

            this.dash.segmentNumber += 1
          }
        } catch (error: any) {
          if (error.name !== 'AbortError') {
            reject(error)
          }
        }
      })
    }
  }
}
