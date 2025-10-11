import flvParser from './flv264Parser'
import { Header, On, TagType } from './type'

export class Demuxer {
  private parseSpeed = 8
  private parseTimer = 0
  private pushFuncs: Function[] = []
  private payload = new Uint8Array(0)
  private offset = 0
  private is_parsing = false // 是否正在解析
  private header: Header | undefined
  private tag: any

  public on: On = {}

  constructor() {}

  init = () => {
    this.destroy()
    this.parseTimer = setInterval(this.parse, this.parseSpeed)
  }

  push = (payload: Uint8Array) => {
    const func = () => {
      // 合并数据
      const _payload = new Uint8Array(this.payload.byteLength + payload.byteLength)
      _payload.set(this.payload, 0)
      _payload.set(payload, this.payload.byteLength)
      this.payload = _payload
    }
    this.pushFuncs.push(func)
  }

  destroy = () => {
    clearInterval(this.parseTimer)
    this.pushFuncs = []
    this.payload = new Uint8Array(0)
    this.offset = 0
    this.is_parsing = false
    this.header = undefined
    this.tag = undefined
  }

  private parse = async () => {
    if (this.pushFuncs.length === 0 || this.is_parsing === true) return
    this.is_parsing = true

    {
      const pushFunc = this.pushFuncs.shift()
      pushFunc && pushFunc()
    }
    const view = new DataView(this.payload.buffer)

    if (!this.header) {
      this.parseHeader(view)
    }
    await this.parseTag(view)

    this.is_parsing = false
  }

  private parseHeader = (view: DataView) => {
    this.header = {
      signature: flvParser.header.getSignature(view),
      version: flvParser.header.getVersion(view),
      flags: flvParser.header.getFlags(view),
      dataOffset: flvParser.header.getDataOffset(view)
    }
    this.offset = this.header?.dataOffset
    this.on.header && this.on.header(this.header)
    return this.header
  }

  private parseTag = async (view: DataView) => {
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
        this.offset = 0 // 重置为0
        break
      }

      const tagHeader = parseTagHeader(view, this.offset + 4) // previousTagSize(4)

      const { tagType, dataSize } = tagHeader

      if (!tagType) break

      const tagBody = parseTagBody(tagType, view, this.offset + 4 + 11, dataSize) // previousTagSize(4) tagHeader(11)

      this.tag = { header: tagHeader, body: tagBody }

      this.on.tag && this.on.tag(this.tag)

      this.offset = this.offset + 4 + 11 + dataSize // previousTagSize(4) tagHeader(11) tagBody(dataSize)

      await new Promise((resolve) => setTimeout(() => resolve(true), this.parseSpeed))
    }
  }
}
