import { Cacher } from './Cacher'
import type { Chunk } from './Cacher'
import { ParseTS } from './ts264Parser'
import { ParseFLV } from './flv264Parser'
import { Pattern } from '../type'

export interface AudioConfig {
  kind: 'audio'
  codec: string
  sampleRate: number
  numberOfChannels: number
}

export interface VideoConfig {
  kind: 'video'
  codec: string
  sps: Uint8Array
  pps: Uint8Array
  description: Uint8Array
}

export interface On {
  debug?: (_debug: unknown) => void
  info?: (_info: any) => void
  config?: (_config: AudioConfig | VideoConfig) => void
  chunk?: (_chunk: Chunk) => void
  sei?: (_sei: Uint8Array[]) => void
}

export class Demuxer {
  private pattern: Pattern | undefined

  cacher = new Cacher()

  private isParseing = false

  private offset = 0

  public on: On = {}

  private parser: ParseFLV | ParseTS | undefined

  constructor() {}

  init = (pattern: Pattern) => {
    this.destroy()
    this.pattern = pattern
    switch (this.pattern) {
      case 'flv':
        {
          this.parser = new ParseFLV()
        }
        break
      case 'hls':
        {
          this.parser = new ParseTS()
        }
        break
      default:
        throw new Error('is error pattern.')
    }

    this.parser.on.debug = (e) => this.on.debug && this.on.debug(e)
    this.parser.on.info = (info) => this.on.info && this.on.info(info)
    this.parser.on.config = (config) => this.on.config && this.on.config(config)

    this.parser.on.chunk = (chunk) => {
      this.cacher.pushChunk(chunk)
      this.on.chunk && this.on.chunk(chunk)
    }
  }

  push = (payload: Uint8Array) => {
    this.cacher.push(payload)
    if (this.isParseing === false) {
      this.parse()
    }
  }

  destroy = () => {
    this.cacher.destroy()
    this.isParseing = false
    this.offset = 0
  }

  private parse = async () => {
    try {
      this.isParseing = true
      if (!this.pattern) {
        throw new Error('You need to set the pattern.')
      }
      if (!this.parser) {
        throw new Error('You need to init parser.')
      }

      while (true) {
        const view = this.cacher.next(this.offset)
        this.offset = 0 // 重置解析索引位
        if (!view) break
        this.offset = await this.parser.parse(view)
      }
      this.isParseing = false
    } catch (error) {
      this.destroy()
    }
  }
}
