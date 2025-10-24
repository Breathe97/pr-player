// 参考 https://www.jianshu.com/p/f667edff9748
// 参考 https://www.cnblogs.com/yaozhongxiao/archive/2013/04/12/3016302.html
// 参考 https://blog.csdn.net/shaosunrise/article/details/121548065
// 参考 https://www.cnblogs.com/saysmy/p/10716886.html

import { parseAVCC } from './264Parser'
import { Nalu } from './type'

const textDecoder = new TextDecoder('utf-8') // 指定编码格式

const getUint24 = (view: DataView, offset: number) => {
  const num = (view.getUint8(offset) << 16) | (view.getUint8(offset + 1) << 8) | view.getUint8(offset + 2)
  return num
}

// [0,1,2]字节
export const getSignature = (view: DataView) => {
  const u8Array = new Int8Array(view.buffer.slice(0, 3))
  return textDecoder?.decode(u8Array) || ''
}

// [3]字节
export const getVersion = (view: DataView) => {
  return view.getUint8(3)
}

// [4]字节
export const getFlags = (view: DataView) => {
  const str = view.getUint8(0).toString(2).padStart(5, '0')
  const arr = str.split('')
  const [, , video, , audio] = arr

  return {
    audio: audio === '1' ? true : false,
    video: video === '1' ? true : false
  }
}

// [5,6,7,8]字节
export const getDataOffset = (view: DataView) => {
  return view.getUint32(5)
}

// [0,~,8]字节
export const header = { getSignature, getVersion, getFlags, getDataOffset }

export const isSurplusTag = (view: DataView, offset: number) => {
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

// [0,1,2,3]字节
export const getPreviousTagSize = (view: DataView, offset: number) => {
  const size = view.getUint32(offset)
  return size
}

// [0]字节
export const getTagType = (view: DataView, offset: number) => {
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
  return str
}

// [1,2,3]字节
export const getDataSize = (view: DataView, offset: number) => {
  const num = getUint24(view, offset + 1)
  return num
}

// [4,5,6]字节
export const getTimestamp = (view: DataView, offset: number) => {
  const num = getUint24(view, offset + 4)
  return num
}

// [7]字节
export const getTimestampExtended = (view: DataView, offset: number) => {
  return view.getUint8(offset + 7)
}

// [8,9,10]字节
export const getStreamID = (view: DataView, offset: number) => {
  const num = getUint24(view, offset + 8)
  return num
}

export const getNaluHeader = (view: DataView, offset: number) => {
  const num = view.getUint8(offset)
  const forbidden_zero_bit = (num >> 7) & 0x01 // 必为0
  const nal_ref_idc = (num >> 5) & 0x03 // 参考优先级（0-3）
  const nal_unit_type = num & 0x1f // NALU类型（1-31）
  return { forbidden_zero_bit, nal_ref_idc, nal_unit_type }
}

export const getAmfType = (view: DataView, offset: number) => {
  const amfType = view.getUint8(offset)
  return amfType
}

export const getAMFName = (view: DataView, offset: number, size: number) => {
  const u8Array = new Uint8Array(view.buffer.slice(offset, offset + size))
  const key = textDecoder?.decode(u8Array) || ''
  return key
}

export const getAMFValue = (view: DataView, offset: number, amfType: number) => {
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
        const str = textDecoder?.decode(u8Array) || ''
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

          const key = getAMFName(view, currentOffset, name_size)
          currentOffset = currentOffset + name_size

          const amfType = getAmfType(view, currentOffset)
          if (amfType === 0x06) break
          currentOffset = currentOffset + 1

          const res = getAMFValue(view, currentOffset, amfType)
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

          const key = getAMFName(view, currentOffset, name_size)
          currentOffset = currentOffset + name_size

          const amfType = getAmfType(view, currentOffset)
          currentOffset = currentOffset + 1

          const res = getAMFValue(view, currentOffset, amfType)
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
          const amfType = getAmfType(view, currentOffset)
          currentOffset = currentOffset + 1

          const res = getAMFValue(view, currentOffset, amfType)
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

export const parseMetaData = (view: DataView, offset: number) => {
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
    const str = textDecoder?.decode(u8Array) || ''
    if (str !== 'onMetaData') throw new Error("Expected 'onMetaData' string")
    currentOffset = currentOffset + size
  }

  // [0]字节
  const amfType = getAmfType(view, currentOffset)
  currentOffset = currentOffset + 1

  // 递归解析
  const res = getAMFValue(view, currentOffset, amfType)

  return res.value
}

export const parseAudio = (view: DataView, offset: number, dataSize: number) => {
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

export const parseVideo = (view: DataView, offset: number, dataSize: number) => {
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
          const nalus: Nalu[] = []

          const maxSize = currentOffset + dataSize - 5

          while (currentOffset + 4 < maxSize) {
            // NALU长度
            const size = view.getUint32(currentOffset, false)
            currentOffset = currentOffset + 4

            // NALU Header
            const header = getNaluHeader(view, currentOffset)
            currentOffset = currentOffset + 1

            const payloadLength = size - 1

            const payload = new Uint8Array(view.buffer.slice(currentOffset, currentOffset + payloadLength))
            currentOffset = currentOffset + payloadLength

            nalus.push({ size, header, payload })
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

export const tagHeader = { getTagType, getDataSize, getTimestamp, getTimestampExtended, getStreamID }

export const tagBody = { parseAudio, parseVideo, parseMetaData }

export const tag = { tagHeader, tagBody }

export default { header, getPreviousTagSize, isSurplusTag, tag }
