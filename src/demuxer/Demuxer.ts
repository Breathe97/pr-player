import { Cacher } from '../cacher/Cacher'
import { ParseTS } from './ts264Parser'
import { ParseFLV } from './flv264Parser'
import { Pattern } from './type'

export interface On {
  debug?: (_debug: any) => void
  config?: (_config: any) => void
  chunk?: (_chunk: any) => void
  audio?: (_audio: any) => void
  video?: (_video: any) => void
}

export class Demuxer {
  private pattern: Pattern | undefined

  cacher = new Cacher()

  private isParseing = false

  private offset = 0

  public on: On = {}

  private parser: ParseTS | ParseFLV | undefined

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
    }
    if (!this.parser) return
    this.parser.on.debug = (e) => this.on.debug && this.on.debug(e)
    this.parser.on.config = (config) => this.on.config && this.on.config(config)
    this.parser.on.chunk = this.onChunk
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

  private onChunk = (chunk: any) => {
    this.cacher.pushChunk(chunk)
    this.on.chunk && this.on.chunk(chunk)
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
