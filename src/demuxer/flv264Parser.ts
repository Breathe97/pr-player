// 参考 https://www.jianshu.com/p/f667edff9748
// 参考 https://www.cnblogs.com/yaozhongxiao/archive/2013/04/12/3016302.html
// 参考 https://blog.csdn.net/shaosunrise/article/details/121548065
// 参考 https://www.cnblogs.com/saysmy/p/10716886.html

import { Chunk } from '../cacher/Cacher'
import { parseAVCC } from './264Parser'
import { AudioConfig, VideoConfig } from './Demuxer'

const getUint24 = (view: DataView, offset: number) => {
  const num = (view.getUint8(offset) << 16) | (view.getUint8(offset + 1) << 8) | view.getUint8(offset + 2)
  return num
}

export interface On {
  debug?: (_debug: any) => void
  info?: (_info: any) => void
  config?: (_config: AudioConfig | VideoConfig) => void
  chunk?: (_chunk: Chunk) => void
}

export class ParseFLV {
  audioConfig?: AudioConfig
  videoConfig?: VideoConfig

  header?: any

  textDecoder = new TextDecoder('utf-8') // 指定编码格式

  public on: On = {}

  constructor() {}

  parse = async (view: DataView) => {
    let offset = 0
    if (!this.header) {
      this.parseHeader(view, offset)
      offset += 9
    }

    while (true) {
      const isSurplus = this.isSurplusTag(view, offset) // 判断后续数据是否是完整tag 如果不是则跳出本次解析 等待后续数据
      if (isSurplus === false) break // 后续数据长度不足 终止本次解析

      const tagHeader = this.parseTagHeader(view, offset + 4) // previousTagSize(4)

      const { tagType, dataSize, timestamp: dts } = tagHeader
      if (tagType) {
        const tagBody = this.parseTagBody(tagType, view, offset + 4 + 11, dataSize) // previousTagSize(4) tagHeader(11)

        switch (tagType) {
          case 'script':
            {
              this.on.info && this.on.info(tagBody)
            }
            break
          case 'audio':
            {
              const { accPacketType } = tagBody

              // 音频配置
              if (accPacketType === 0) {
                const { codec, sampleRate, channelConfiguration } = tagBody
                this.audioConfig = { kind: 'audio', codec, sampleRate, numberOfChannels: channelConfiguration }
                this.on.config && this.on.config(this.audioConfig)
              }
              // 音频帧数据
              else {
                const { cts, data } = tagBody
                const type = 'key'
                const pts = cts === undefined ? undefined : cts + dts

                this.on.chunk && this.on.chunk({ kind: 'audio', type, dts, pts, cts, data })
              }
            }
            break

          case 'video':
            {
              const { avcPacketType } = tagBody

              // 视频配置
              if (avcPacketType === 0) {
                const { codec, sps, pps, data: description } = tagBody
                this.videoConfig = { kind: 'video', codec, description, sps, pps }
                this.on.config && this.on.config(this.videoConfig)
              }
              // 视频帧数据
              else {
                const { frameType, cts, data, nalus } = tagBody
                const type = frameType === 1 ? 'key' : 'delta'
                const pts = cts === undefined ? undefined : cts + dts

                this.on.chunk && this.on.chunk({ kind: 'video', type, dts, pts, cts, data, nalus })
              }
            }
            break
        }

        offset = offset + 4 + 11 + dataSize // previousTagSize(4) tagHeader(11) tagBody(dataSize)
      }
      await new Promise((resolve) => setTimeout(() => resolve(true), 8))
    }
    return offset
  }

  // Header
  private parseHeader = (view: DataView, offset: number) => {
    let signature, version, flags, dataOffset

    {
      signature = (view.getUint8(offset) << 16) | (view.getUint8(offset + 1) << 8) | view.getUint8(offset + 2)
    }

    {
      version = view.getUint8(3)
    }

    {
      const str = view.getUint8(0).toString(2).padStart(5, '0')
      const arr = str.split('')
      const [, , video, , audio] = arr
      flags = { audio: audio === '1' ? true : false, video: video === '1' ? true : false }
    }

    {
      dataOffset = view.getUint32(5)
    }

    this.header = { signature, version, flags, dataOffset }
  }

  // 是否是完整tag
  private isSurplusTag = (view: DataView, offset: number) => {
    let legal = true // 默认合法
    const length = view.byteLength

    // previousTagSize 不完整
    if (offset + 4 > length) {
      legal = false
    }
    // tagHeader 不完整
    else if (offset + 4 + 11 > length) {
      legal = false
    }
    // tagBody 不完整
    else {
      const dataSize = getUint24(view, offset + 4 + 1) // 数据长度
      const needLength = offset + 4 + 11 + dataSize
      // 剩余的长度足够
      if (needLength > length) {
        legal = false
      }
    }
    return legal
  }

  private parseTagHeader = (view: DataView, offset: number) => {
    let tagType, dataSize, timestamp, timestampExtended, streamID

    {
      const num = view.getUint8(offset)
      let str: 'script' | 'audio' | 'video' | undefined
      switch (num) {
        case 18:
          str = 'script'
          break
        case 8:
          str = 'audio'
          break
        case 9:
          str = 'video'
          break
      }
      tagType = str
    }

    {
      dataSize = getUint24(view, offset + 1)
    }

    {
      timestamp = getUint24(view, offset + 4)
    }

    {
      timestampExtended = view.getUint8(offset + 7)
    }

    {
      streamID = getUint24(view, offset + 8)
    }
    return { tagType, dataSize, timestamp, timestampExtended, streamID }
  }

  private parseTagBody = (tagType: string, view: DataView, offset: number, dataSize: number) => {
    let tagBody
    switch (tagType) {
      case 'script':
        {
          tagBody = this.parseMetaData(view, offset)
        }
        break
      case 'audio':
        {
          tagBody = this.parseAudio(view, offset, dataSize)
        }
        break

      case 'video':
        {
          tagBody = this.parseVideo(view, offset, dataSize)
        }
        break
    }
    return tagBody
  }

  private parseMetaData = (view: DataView, offset: number) => {
    let currentOffset = offset
    // [0]字节
    {
      const amfType = view.getUint8(currentOffset)
      if (amfType !== 0x02) throw new Error('Invalid AMF type for onMetaData (expected 0x02)')
      currentOffset = currentOffset + 1
    }

    // [1，2]字节
    const size = view.getUint16(currentOffset, false) // 大端序
    currentOffset = currentOffset + 2

    // [3,size]字节 一般固定为 onMetaData
    {
      const u8Array = new Int8Array(view.buffer.slice(currentOffset, currentOffset + size))
      const str = this.textDecoder?.decode(u8Array) || ''
      if (str !== 'onMetaData') throw new Error("Expected 'onMetaData' string")
      currentOffset = currentOffset + size
    }

    // [0]字节
    const amfType = this.getAmfType(view, currentOffset)
    currentOffset = currentOffset + 1

    // 递归解析
    const res = this.getAMFValue(view, currentOffset, amfType)

    return res.value
  }

  private parseAudio = (view: DataView, offset: number, dataSize: number) => {
    let currentOffset = offset

    // [0]
    const num = view.getUint8(currentOffset)

    const soundFormat = (num >> 4) & 0x0f // 音频编码格式
    const soundRate = (num >> 2) & 0x03 // 采样率
    const soundSize = (num >> 1) & 0x01 // 采样位数
    const soundType = num & 0x01 // 声道模式
    currentOffset = currentOffset + 1

    // [1]
    const accPacketType = view.getUint8(currentOffset)
    currentOffset = currentOffset + 1

    // [2,dataSize]字节
    const payloadSize = dataSize - 2
    const data = new Uint8Array(view.buffer.slice(currentOffset, currentOffset + payloadSize))

    // aac
    if (soundFormat === 10) {
      if (accPacketType === 0) {
        const num = view.getUint8(currentOffset)
        const num_1 = view.getUint8(currentOffset + 1)

        const audioObjectType = (num & 0xf8) >> 3
        const samplingFrequencyIndex = ((num & 0x07) << 1) | (num_1 >> 7)
        const channelConfiguration = (num_1 & 0x78) >> 3

        // 采样率对照表
        const sampleRates = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350]

        const codec = `mp4a.40.${audioObjectType}`

        const sampleRate = sampleRates[samplingFrequencyIndex]

        return { soundFormat, soundRate, soundSize, soundType, accPacketType, data, audioObjectType, samplingFrequencyIndex, channelConfiguration, codec, sampleRate }
      }
    }

    return { soundFormat, soundRate, soundSize, soundType, accPacketType, data }
  }

  private parseVideo = (view: DataView, offset: number, dataSize: number) => {
    let currentOffset = offset
    // [0]字节
    const num = view.getUint8(currentOffset)
    const frameType = (num >> 4) & 0x0f // 帧类型
    const codecID = num & 0x0f // 视频编码格式
    currentOffset = currentOffset + 1

    // [1]字节
    const avcPacketType = view.getUint8(currentOffset) // AVC 包类型（仅 H.264）
    currentOffset = currentOffset + 1

    // [2,3,4]字节
    const cts = getUint24(view, currentOffset)
    currentOffset = currentOffset + 3

    // [5,dataSize]字节
    const payloadSize = dataSize - 5
    const data = new Uint8Array(view.buffer.slice(currentOffset, currentOffset + payloadSize))

    switch (codecID) {
      case 7: // H.264 AVCC
        {
          // config sps pps
          if (avcPacketType === 0) {
            // [0]字节 固定为1（H.264标准要求）
            const config = parseAVCC(data)

            return { frameType, codecID, avcPacketType, cts, data, ...config }
          }
          // video data
          else if (avcPacketType === 1) {
            const nalus = []

            const maxSize = currentOffset + dataSize - 5

            while (true) {
              if (currentOffset + 4 > maxSize) break
              // NALU长度
              const size = view.getUint32(currentOffset, false)

              const nalu = new Uint8Array(view.buffer.slice(currentOffset, currentOffset + 4 + size))
              currentOffset += 4 + size

              nalus.push(nalu)
            }

            return { frameType, codecID, avcPacketType, cts, data, nalus }
          }
        }
        break

      default: {
        throw new Error('Unsupported codecID')
      }
    }

    return { frameType, codecID, avcPacketType, cts, data }
  }

  private getAmfType = (view: DataView, offset: number) => {
    const amfType = view.getUint8(offset)
    return amfType
  }

  private getAMFName = (view: DataView, offset: number, size: number) => {
    const u8Array = new Uint8Array(view.buffer.slice(offset, offset + size))
    const key = this.textDecoder?.decode(u8Array) || ''
    return key
  }

  private getAMFValue = (view: DataView, offset: number, amfType: number) => {
    let currentOffset = offset
    let value: any
    let length = 0
    switch (amfType) {
      case 0x00: // Number
        {
          value = view.getFloat64(currentOffset, false)
          length = 8
        }
        break
      case 0x01: // Boolean
        {
          value = !!view.getUint8(currentOffset)
          length = 1
        }
        break
      case 0x02: // String
        {
          value = ''
          const size = view.getUint16(currentOffset, false)
          currentOffset = currentOffset + 2

          const u8Array = new Int8Array(view.buffer, currentOffset, size).filter((item) => item !== 0x00)
          const str = this.textDecoder?.decode(u8Array) || ''
          value = str.trim()
          length = 2 + size
        }
        break
      case 0x03: // Object
        {
          value = {}

          while (currentOffset < view.byteLength) {
            const name_size = view.getUint16(currentOffset, false)
            if (name_size === 0) break
            currentOffset = currentOffset + 2

            const key = this.getAMFName(view, currentOffset, name_size)
            currentOffset = currentOffset + name_size

            const amfType = this.getAmfType(view, currentOffset)
            if (amfType === 0x06) break
            currentOffset = currentOffset + 1

            const res = this.getAMFValue(view, currentOffset, amfType)
            currentOffset = currentOffset + res.length

            value[key] = res.value

            length = 2 + name_size + 1 + res.length
          }
        }
        break
      case 0x08: // Array Object
        {
          value = {}
          const key_num = view.getUint32(currentOffset, false) // 属性个数
          currentOffset = currentOffset + 4

          for (let index = 0; index < key_num; index++) {
            const name_size = view.getUint16(currentOffset, false)
            currentOffset = currentOffset + 2

            const key = this.getAMFName(view, currentOffset, name_size)
            currentOffset = currentOffset + name_size

            const amfType = this.getAmfType(view, currentOffset)
            currentOffset = currentOffset + 1

            const res = this.getAMFValue(view, currentOffset, amfType)
            currentOffset = currentOffset + res.length

            value[key] = res.value
            length = 2 + name_size + 1 + res.length
          }
        }
        break
      case 0x0a: // Array Any
        {
          value = []
          const key_num = view.getUint32(currentOffset, false) // 属性个数
          currentOffset = currentOffset + 4
          for (let index = 0; index < key_num; index++) {
            const amfType = this.getAmfType(view, currentOffset)
            currentOffset = currentOffset + 1

            const res = this.getAMFValue(view, currentOffset, amfType)
            currentOffset = currentOffset + res.length
            value.push(res.value)
            length = 1 + res.length
          }
        }
        break
    }
    const res = { amfType, length, value }
    return res
  }
}
