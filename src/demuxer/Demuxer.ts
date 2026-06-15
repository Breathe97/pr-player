import { Cacher } from './Cacher'

import type { Chunk } from './Cacher'

import { ParseFLV } from './parsers/flv264Parser'

import { ParseTS } from './parsers/ts264Parser'

import { ParseFMP4 } from './parsers/fmp4Parser'

import type { Pattern } from '../type'



export type { AudioConfig, VideoConfig } from './parsers/types'



export interface On {

  debug?: (_debug: unknown) => void

  info?: (_info: any) => void

  config?: (_config: import('./parsers/types').AudioConfig | import('./parsers/types').VideoConfig) => void

  chunk?: (_chunk: Chunk) => void

  sei?: (_sei: Uint8Array[]) => void

}



export class Demuxer {

  private pattern: Pattern | undefined



  cacher = new Cacher()



  private isParseing = false



  private offset = 0



  private parser: ParseFLV | ParseTS | ParseFMP4 | undefined



  public on: On = {}

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

      case 'dash':

      case 'mp4':

        {

          this.parser = new ParseFMP4()

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

        this.offset = 0

        if (!view) break

        const parsed = await this.parser.parse(view)

        if (this.pattern === 'mp4' || this.pattern === 'dash') {
          const fmp4 = this.parser as ParseFMP4
          this.offset = fmp4.getDiscardOffset(view.byteLength, view)
        } else {
          this.offset = parsed
        }

      }

      this.isParseing = false

    } catch (error) {

      this.isParseing = false

      this.on.debug?.({ demuxer: 'error', message: String(error), stack: error instanceof Error ? error.stack : undefined })
    }

  }

}


