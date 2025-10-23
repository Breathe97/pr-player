import flvParser from './flv264Parser'
import { ParseTS } from './ts264Parser'
import { Header, On, Pattern, TagType } from './type'

export class Demuxer {
  private pattern: Pattern | undefined
  private parseSpeed = 8
  private pendingPayloads: Uint8Array[] = []
  private payload = new Uint8Array(0)

  private offset = 0
  private is_parsing = false // 是否正在解析
  private header: Header | undefined
  private tag: any

  public on: On = {}

  private parseTS = new ParseTS()

  constructor() {
    this.parseTS.on.debug = (e) => this.on.ts?.debug && this.on.ts?.debug(e)
    this.parseTS.on.pat = (pat) => this.on.ts?.pat && this.on.ts?.pat(pat)
    this.parseTS.on.pmt = (pmt) => this.on.ts?.pmt && this.on.ts?.pmt(pmt)
    this.parseTS.on.config = (config) => this.on.ts?.config && this.on.ts?.config(config)
    this.parseTS.on.audio = (audio) => this.on.ts?.audio && this.on.ts?.audio(audio)
    this.parseTS.on.video = (video) => this.on.ts?.video && this.on.ts?.video(video)
  }

  flv = {
    parseHeader: (view: DataView) => {
      this.header = {
        signature: flvParser.header.getSignature(view),
        version: flvParser.header.getVersion(view),
        flags: flvParser.header.getFlags(view),
        dataOffset: flvParser.header.getDataOffset(view)
      }
      this.offset = this.header?.dataOffset
      this.on.header && this.on.header(this.header)
      return this.header
    },
    parseTag: async (view: DataView) => {
      const parseTagHeader = (view: DataView, offset: number) => {
        const obj = {
          tagType: flvParser.tag.tagHeader.getTagType(view, offset),
          dataSize: flvParser.tag.tagHeader.getDataSize(view, offset),
          timestamp: flvParser.tag.tagHeader.getTimestamp(view, offset),
          timestampExtended: flvParser.tag.tagHeader.getTimestampExtended(view, offset),
          streamID: flvParser.tag.tagHeader.getStreamID(view, offset)
        }
        return obj
      }

      const parseTagBody = (tagType: TagType, view: DataView, offset: number, dataSize: number) => {
        let tagBody
        switch (tagType) {
          case 'script':
            {
              tagBody = flvParser.tag.tagBody.parseMetaData(view, offset)
            }
            break
          case 'audio':
            {
              tagBody = flvParser.tag.tagBody.parseAudio(view, offset, dataSize)
            }
            break

          case 'video':
            {
              tagBody = flvParser.tag.tagBody.parseVideo(view, offset, dataSize)
            }
            break
        }
        return tagBody
      }

      while (this.offset < view.byteLength) {
        const isSurplus = flvParser.isSurplusTag(view, this.offset) // 判断后续数据是否是完整tag 如果不是则跳出本次解析 等待后续数据
        if (isSurplus === false) {
          this.payload = this.payload.slice(this.offset) // 后续数据长度不足 跳出合并下一段数据
          break
        }

        const tagHeader = parseTagHeader(view, this.offset + 4) // previousTagSize(4)

        const { tagType, dataSize } = tagHeader

        if (!tagType) break

        const tagBody = parseTagBody(tagType, view, this.offset + 4 + 11, dataSize) // previousTagSize(4) tagHeader(11)

        this.tag = { header: tagHeader, body: tagBody }

        this.on.tag && this.on.tag(this.tag)

        this.offset = this.offset + 4 + 11 + dataSize // previousTagSize(4) tagHeader(11) tagBody(dataSize)

        // await new Promise((resolve) => setTimeout(() => resolve(true), this.parseSpeed))
      }
    }
  }

  hls = {
    parse: async (view: DataView) => {
      while (this.offset < view.byteLength) {
        if (this.offset + 188 > view.byteLength) {
          this.payload = this.payload.slice(this.offset) // 后续数据长度不足 跳出合并下一段数据
          break
        }

        if (view.getInt8(this.offset) != 0x47) {
          this.offset++
          continue
        }
        this.parseTS.parseTsPacket(view, this.offset)
        this.offset += 188
        // await new Promise((resolve) => setTimeout(() => resolve(true), 2))
      }
    }
  }

  init = () => {
    this.destroy()
  }

  setPattern = (pattern: Pattern) => {
    this.pattern = pattern
  }

  push = (payload: Uint8Array) => {
    this.pendingPayloads.push(payload)

    if (!this.is_parsing) {
      this.parse()
    }
  }

  destroy = () => {
    this.pendingPayloads = []
    this.payload = new Uint8Array(0)
    this.offset = 0
    this.is_parsing = false
    this.header = undefined
    this.tag = undefined
  }

  private parse = async () => {
    if (!this.pattern) {
      throw new Error('You need to set the pattern.')
    }
    this.is_parsing = true

    while (true) {
      const payload = this.pendingPayloads.shift()
      if (!payload) break
      // 合并数据
      const _payload = new Uint8Array(this.payload.byteLength + payload.byteLength)

      _payload.set(this.payload, 0)
      _payload.set(payload, this.payload.byteLength)

      this.payload = _payload
      this.offset = 0

      const view = new DataView(this.payload.buffer)

      switch (this.pattern) {
        case 'flv':
          {
            if (!this.header) {
              this.flv.parseHeader(view)
            }
            await this.flv.parseTag(view)
          }
          break
        case 'hls':
          {
            await this.hls.parse(view)
          }
          break
      }
    }

    this.is_parsing = false
  }
}
