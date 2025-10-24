// 参考 https://zhuanlan.zhihu.com/p/496813890

import { createAVCC, nalusToAVCC, naluToAVCC, parseAVCC } from './264Parser'

const getMediaKind = (stream_type: number) => {
  // ​​视频流​​：0x01（MPEG-1）、0x02（MPEG-2）、0x1B（H.264）、0x24（HEVC）。
  // ​​音频流​​：0x03（MPEG-1）、0x04（MPEG-2）、0x0F（AAC）。
  // ​​私有数据​​：0x06（字幕）、0x86（广告标记）。

  let kind = 'unknown'
  switch (stream_type) {
    case 0x01:
    case 0x02:
    case 0x1b:
    case 0x24:
      kind = 'video'
      break
    case 0x03:
    case 0x04:
    case 0x0f:
      kind = 'audio'
      break
    case 0x06:
      kind = 'subtitle'
      break
    case 0x86:
      kind = 'ad'
      break
  }

  return kind
}

export interface Pat {
  header: {
    pointer_field: number
    table_id: number
    section_length: number
    transport_stream_id: number
    version_number: number
    current_next_indicator: number
    section_number: number
    last_section_number: number
  }
  programs: Array<{ program_number: number; pmt_pid: number }>
  crc32: number
}

export interface Pmt {
  header: {
    pointer_field: number
    table_id: number
    section_length: number
    transport_stream_id: number
    version_number: number
    current_next_indicator: number
    section_number: number
    last_section_number: number
    pcr_pid: number
    program_info_length: number
  }
  streams: Array<{ kind: string; stream_type: number; elementary_pid: number; es_info_length: number }>
  crc32: number
}

export interface Config {
  audio?: {}

  video?: {
    codec?: string
    sps?: Uint8Array
    pps?: Uint8Array
    description?: Uint8Array
  }
}

export interface PESPacket {
  stream_id: number
  pts?: number // Presentation Timestamp (90kHz)
  dts?: number // Decoding Timestamp (90kHz)
  data: Uint8Array // PES Payload (e.g., H.264 NALU)
}

export interface On {
  debug?: (_debug: any) => void
  config?: (_config: any) => void
  chunk?: (_chunk: any) => void

  pat?: (_pat: Pat) => void
  pmt?: (_pmt: Pmt) => void
  audio?: (_e: any) => void
  video?: (_e: any) => void
}

export class ParseTS {
  pat?: Pat
  pmt?: Pmt
  config: Config = {
    audio: undefined,
    video: undefined
  }

  payloadMap: Map<number, Uint8Array> = new Map()

  public on: On = {}

  constructor() {}

  parse = async (view: DataView) => {
    let offset = 0
    while (true) {
      if (offset + 188 > view.byteLength) break

      if (view.getInt8(offset) != 0x47) {
        offset++
        continue
      }
      await this.parsePacket(view, offset)
      offset += 188
    }
    return offset
  }

  private parsePacket = async (view: DataView, offset: number) => {
    if (offset + 188 > view.byteLength) {
      throw new Error('Invalid TS packet')
    }
    if (view.getUint8(offset) !== 0x47) {
      throw new Error('Invalid TS packet')
    }

    let currentOffset = offset

    // 读取 4 字节的 TS Header
    const header = this.parseHeader(view, currentOffset)
    currentOffset += 4

    const { transport_error_indicator, pid, payload_unit_start_indicator, adaptation_field_control } = header
    if (transport_error_indicator === 1 || pid === undefined) return // 错误包
    let payloadLength = 188 - 4

    // 解析自适应字段(如果存在)
    let adaptationField

    // (8b) 表示 AdaptationField的总字节数（不包括本字段）。如果为 0，则仅填充字节（0xFF）存在。
    if (adaptation_field_control === 2 || adaptation_field_control === 3) {
      const adaptation_field_length = view.getUint8(currentOffset)
      currentOffset += 1

      adaptationField = this.parseAdaptationField(view, currentOffset)
      currentOffset += adaptation_field_length
      payloadLength -= adaptation_field_length
    }

    if (adaptation_field_control === 3) {
      payloadLength -= 1
    }

    // 解析有效载荷(如果存在)
    if (adaptation_field_control === 1 || adaptation_field_control === 3) {
      const payload = new Uint8Array(view.buffer.slice(currentOffset, currentOffset + payloadLength))

      // 解析 PAT
      {
        const isPAT = pid === 0
        if (isPAT) return this.parsePAT(view, currentOffset)
      }

      // 解析 PMT
      {
        const { programs = [] } = this.pat || {}
        const isPMT = programs.find((program) => program.pmt_pid === pid) // 判断是否为pmt表
        if (isPMT) return this.parsePMT(view, currentOffset)
      }

      const { streams = [] } = this.pmt || {}
      const streamInfo = streams.find((stream) => stream.elementary_pid === pid)
      if (streamInfo) {
        // 新的包
        if (payload_unit_start_indicator === 1) {
          // 解析之前可能存在的包
          const payload = this.payloadMap.get(pid)
          if (payload) {
            switch (streamInfo.kind) {
              case 'video':
                {
                  const chunk = await this.parseVideo(payload)
                  this.on.chunk && this.on.chunk(chunk)
                  await new Promise((resolve) => setTimeout(() => resolve(true), 8))
                }
                break
            }

            this.payloadMap.delete(pid) // 解析完成 删除缓存
          }
        }

        // 合并 payload
        {
          if (!this.payloadMap.has(pid)) {
            this.payloadMap.set(pid, new Uint8Array())
          }

          const old_payload = this.payloadMap.get(pid)!
          const _payload = new Uint8Array(old_payload.byteLength + payload.byteLength)

          _payload.set(old_payload, 0)
          _payload.set(payload, old_payload.byteLength)
          this.payloadMap.set(pid, _payload)
        }
      }
    }
  }

  // Header
  private parseHeader = (view: DataView, offset: number) => {
    let currentOffset = offset
    const sync_byte = view.getUint8(currentOffset) // 第0-7位(8b) 固定为 0x47，用于标识 TS 包的开始。
    const byte2 = view.getUint8(currentOffset + 1)
    const byte3 = view.getUint8(currentOffset + 2)
    const byte4 = view.getUint8(currentOffset + 3)

    const transport_error_indicator = (byte2 & 0x80) >> 7 // 第8位(1b) 1表示当前包存在传输错误。
    if (transport_error_indicator === 1) return { sync_byte, transport_error_indicator }

    const payload_unit_start_indicator = (byte2 & 0x40) >> 6 // 第9位(1b) 1表示 PES 包或 PSI 表的开始。

    const transport_priority = (byte2 & 0x20) >> 5 // 第10位(1b) 1表示此包优先级更高。
    const pid = ((byte2 & 0x1f) << 8) | byte3 // 第11-23位(13b) 包标识符（Packet ID），用于区分不同的流。

    const transport_scrambling_control = (byte4 & 0xc0) >> 6 // 第24-25位(2b) 加密控制：00=未加密，01=保留，10=偶密钥，11=奇密钥。
    const adaptation_field_control = (byte4 >> 4) & 0x03 // 第26-27位(2b) 控制字段：00=保留，01=仅有效负载，10=仅 Adaptation Field，11=两者都有。
    const continuity_counter = byte4 & 0x0f // 第28-31位(4b) 包计数器（0~15），用于检测丢包或重复包。

    return { sync_byte, transport_error_indicator, payload_unit_start_indicator, transport_priority, pid, transport_scrambling_control, adaptation_field_control, continuity_counter }
  }

  // PAT表
  private parsePAT = (view: DataView, offset: number) => {
    let currentOffset = offset

    // PAT 头部固定为 ​​8 字节​​
    let header
    {
      const pointer_field = view.getUint8(currentOffset)
      currentOffset += 1

      // 1B 固定 0x00（标识 PAT）
      const table_id = view.getUint8(currentOffset)
      currentOffset += 1
      if (table_id !== 0x00) throw new Error('Invalid PAT table_id')

      // 12b 后面数据的长度
      const section_length = view.getUint16(currentOffset) & 0x0fff
      currentOffset += 2

      // 2B 传输流唯一标识符（自定义或由运营商分配）
      const transport_stream_id = view.getUint16(currentOffset)
      currentOffset += 2

      // 版本号（用于检测 PAT 更新）
      const version_number = (view.getUint8(currentOffset) & 0x3e) >> 1
      const current_next_indicator = view.getUint8(currentOffset) & 0x01
      currentOffset += 1

      // 当前段编号（从 0 开始）
      const section_number = view.getUint8(currentOffset)
      currentOffset += 1

      // 最后段编号（总段数 - 1）
      const last_section_number = view.getUint8(currentOffset)
      currentOffset += 1

      header = { pointer_field, table_id, section_length, transport_stream_id, version_number, current_next_indicator, section_number, last_section_number }
    }

    // 节目列表结构（Program List）​
    const programs = []
    {
      const programLength = header.section_length - 5 - 4 // 需要排除 header部分 和 crc
      const endOffset = currentOffset + programLength

      while (currentOffset < endOffset) {
        const program_number = view.getUint16(currentOffset) // 节目编号：0x0000=NIT（网络信息表），其他值为有效节目编号
        const pmt_pid = view.getUint16(currentOffset + 2) & 0x1fff // 取低 13 位
        currentOffset += 4

        // 跳过不合法的pid
        if (program_number !== 0 && pmt_pid >= 0x0020 && pmt_pid <= 0x1ffe) {
          programs.push({ program_number, pmt_pid })
        }
      }
    }

    // 解析 CRC
    const crc32 = view.getUint32(currentOffset)
    this.pat = { header, programs, crc32 }
    this.on.pat && this.on.pat(this.pat)
  }

  // PMT表
  private parsePMT = (view: DataView, offset: number) => {
    let currentOffset = offset

    // PMT 头部固定为 ​​12 字节​​
    let header
    {
      const pointer_field = view.getUint8(currentOffset)
      currentOffset += 1

      // 1B 固定 0x00（标识 PAT）
      const table_id = view.getUint8(currentOffset)
      currentOffset += 1
      if (table_id !== 0x02) throw new Error('Invalid PMT table_id')

      // 12b 后面数据的长度
      const section_length = view.getUint16(currentOffset) & 0x0fff
      currentOffset += 2

      // 2B 传输流唯一标识符（自定义或由运营商分配）
      const transport_stream_id = view.getUint16(currentOffset)
      currentOffset += 2

      // 版本号（用于检测 PAT 更新）
      const version_number = (view.getUint8(currentOffset) & 0x3e) >> 1
      const current_next_indicator = view.getUint8(currentOffset) & 0x01
      currentOffset += 1

      // 当前段编号（从 0 开始）
      const section_number = view.getUint8(currentOffset)
      currentOffset += 1

      // 最后段编号（总段数 - 1）
      const last_section_number = view.getUint8(currentOffset)
      currentOffset += 1

      const pcr_pid = view.getUint16(currentOffset) & 0x1fff
      currentOffset += 2

      const program_info_length = view.getUint16(currentOffset) & 0x0fff
      currentOffset += 2

      header = { pointer_field, table_id, section_length, transport_stream_id, version_number, current_next_indicator, section_number, last_section_number, pcr_pid, program_info_length }
    }

    const streams = []
    {
      const streamsLength = header.section_length - 9 - 4 // 需要排除 header部分 和 crc
      const endOffset = currentOffset + streamsLength

      while (currentOffset < endOffset) {
        const stream_type = view.getUint8(currentOffset)
        const kind = getMediaKind(stream_type)
        const elementary_pid = view.getUint16(currentOffset + 1) & 0x1fff
        const es_info_length = view.getUint16(currentOffset + 3) & 0x0fff
        currentOffset += 5

        if (elementary_pid < 0x0020 || elementary_pid > 0x1ffe) {
          console.warn(`Invalid elementary_pid: 0x${elementary_pid.toString(16)}`)
          continue
        }

        streams.push({ kind, stream_type, elementary_pid, es_info_length })
      }
    }

    // 解析 CRC
    const crc32 = view.getUint32(currentOffset)
    this.pmt = { header, streams, crc32 }
    this.on.pmt && this.on.pmt(this.pmt)
  }

  // AdaptationField
  private parseAdaptationField = (view: DataView, offset: number) => {
    let currentOffset = offset

    let pcr, opcr, splice_countdown, transport_private_data

    // [8b]
    const flags = view.getUint8(currentOffset) // 控制后续字段的存在，每一位对应一个标志（见下表）。

    const discontinuity_indicator = !!(flags & 0x80) // 7(位) 设为 1表示当前 TS 包属于系统时间不连续点（如节目切换）。
    const random_access_indicator = !!(flags & 0x40) // 6(位)  随机访问点 设为 1表示此 TS 包是关键帧（如视频的 I 帧）的起始点，用于随机访问。
    const elementary_stream_priority_indicator = !!(flags & 0x20) // 5(位)指示 ES 流的优先级（1表示优先级更高）。
    const pcr_flag = !!(flags & 0x10) // 4(位) 设为 1时，AdaptationField包含 PCR字段。
    const opcr_flag = !!(flags & 0x08) // 3(位) 设为 1时，AdaptationField包含 OPCR字段。
    const splicing_point_flag = !!(flags & 0x04) // 2(位) 设为 1时，AdaptationField包含 splice_countdown字段（用于流拼接）。
    const transport_private_data_flag = !!(flags & 0x02) // 1(位) 设为 1时，AdaptationField包含私有数据。
    const adaptation_field_extension_flag = !!(flags & 0x01) // 自适应字段扩展 设为 1时，AdaptationField包含扩展字段。

    currentOffset += 1

    const parsePCR = (view: DataView, offset: number) => {
      let pcr = BigInt(0)
      pcr |= BigInt(view.getUint16(offset)) << 25n
      pcr |= BigInt(view.getUint16(offset + 1)) << 17n
      pcr |= BigInt(view.getUint16(offset + 2)) << 9n
      pcr |= BigInt(view.getUint16(offset + 3)) << 1n
      pcr |= BigInt(view.getUint16(offset + 4) >> 7)

      const pcrExt = ((view.getUint16(offset + 4) & 0x01) << 8) | view.getUint16(offset + 5)
      pcr = pcr * 300n + BigInt(pcrExt)

      return pcr
    }

    // 解析PCR (6B)
    if (pcr_flag) {
      pcr = parsePCR(view, currentOffset)
      currentOffset += 6
    }

    // 解析OPCR (6B)
    if (opcr_flag) {
      opcr = parsePCR(view, currentOffset)
      currentOffset += 6
    }

    // 解析 Splice Countdown
    if (splicing_point_flag) {
      splice_countdown = view.getInt8(currentOffset)
      currentOffset += 1
    }

    // 解析 Transport Private Data
    if (transport_private_data_flag) {
      const private_data_length = view.getUint8(currentOffset)
      currentOffset += 1
      transport_private_data = new Uint8Array(view.buffer, currentOffset, private_data_length)
      currentOffset += private_data_length
    }

    return { discontinuity_indicator, random_access_indicator, elementary_stream_priority_indicator, pcr_flag, opcr_flag, splicing_point_flag, transport_private_data_flag, adaptation_field_extension_flag, pcr, opcr, splice_countdown, transport_private_data }
  }

  private parseVideo = async (payload: Uint8Array) => {
    const view = new DataView(payload.buffer)
    let currentOffset = 0

    let pes_header, pes_payload
    {
      // 固定为 0x000001
      const is_packet_start_code_prefix = view.getUint8(currentOffset) === 0x00 && view.getUint8(currentOffset + 1) === 0x00 && view.getUint8(currentOffset + 2) === 0x01
      currentOffset += 3
      if (!is_packet_start_code_prefix) {
        throw new Error('invalid ts video payload.')
      }

      // 标识流类型（如 0xE0= 视频，0xC0= 音频）
      const stream_id = view.getUint8(currentOffset)
      currentOffset += 1

      // PES 包长度（0 = 可变长度，如视频）
      const pes_packet_length = (view.getUint8(currentOffset) << 8) | view.getUint8(currentOffset + 1)
      currentOffset += 2

      // 解析 Optional PES Header（如果存在）
      let pts: number | undefined, dts: number | undefined

      const optional_header_exist =
        stream_id !== 0xbc && // program_stream_map
        stream_id !== 0xbe && // padding_stream
        stream_id !== 0xbf && // private_stream_2
        stream_id !== 0xf0 && // ECM
        stream_id !== 0xf1 && // EMM
        stream_id !== 0xff && // program_stream_directory
        stream_id !== 0xf2 // DSMCC_stream

      if (optional_header_exist) {
        // 读取 PES 头部标志位
        const flags1 = view.getUint8(currentOffset)
        currentOffset += 1

        const flags2 = view.getUint8(currentOffset)
        currentOffset += 1

        // 解析 PTS/DTS 标志位
        const pts_dts_flags = (flags2 >> 6) & 0b11

        // 读取 PES Header Data Length（后续可选数据的长度）
        const pes_header_data_length = view.getUint8(currentOffset)
        currentOffset += 1

        // 解析 pts dts
        if (pts_dts_flags === 0b10 || pts_dts_flags === 0b11) {
          pts = this.parsePtsDts(view, currentOffset) / 90
          if (pts_dts_flags === 0b11) {
            dts = this.parsePtsDts(view, currentOffset + 5) / 90
          }
        }
        currentOffset += pes_header_data_length
      }
      pes_header = { stream_id, pes_packet_length, pts, dts, optional_header_exist }
    }

    // 解析 PES Payload（H.264 NALU）
    pes_payload = payload.slice(currentOffset)
    {
      const nalus = this.extractNalus(pes_payload)

      // 获取 sps pps
      if (!this.config.video) {
        let sps, pps
        // sps
        {
          const nalu = nalus.find((nalu) => nalu.type === 7)
          sps = nalu?.data
        }
        // pps
        {
          const nalu = nalus.find((nalu) => nalu.type === 8)
          pps = nalu?.data
        }
        if (sps && pps) {
          const description = createAVCC(sps, pps)
          const { codec } = parseAVCC(description)
          this.config.video = { codec, description, sps, pps }
          this.on.config && this.on.config({ kind: 'video', ...this.config.video })
        }
      }

      const nalus_data = []

      let type: 'key' | 'delta' = 'delta'
      for (const nalu of nalus) {
        const { type: naluType, data } = nalu
        switch (naluType) {
          case 9:
            {
              nalus_data.push(data)
            }
            break
          case 1:
            {
              type = 'delta'
              nalus_data.push(data)
            }
            break
          case 5:
            {
              type = 'key'
              nalus_data.push(data)
            }
            break
        }
      }

      const data = nalusToAVCC(nalus_data)

      const { dts = 0, pts = 0 } = pes_header

      const cts = pts - dts

      return { kind: 'video', type, dts, pts, cts, data }
    }
  }

  /**
   * 从 PES Payload 提取 H.264 NALU
   */
  private extractNalus = (payload: Uint8Array) => {
    // 从PES负载中提取H.264 NALU
    const nalUnits = []
    let currentOffset = 0

    while (true) {
      if (currentOffset + 4 > payload.byteLength) break
      // 查找起始码 (0x000001 或 0x00000001)
      if (payload[currentOffset] !== 0x00 || payload[currentOffset + 1] !== 0x00 || payload[currentOffset + 2] !== 0x01) {
        currentOffset += 1
        continue
      }

      // 找到起始码
      currentOffset += 3
      let startOffset = currentOffset

      const naluType = payload[currentOffset] & 0x1f
      currentOffset += 1

      // 查找下一个起始码 (0x000001 或 0x00000001)
      while (true) {
        if (currentOffset + 1 > payload.byteLength) break
        if (payload[currentOffset] !== 0x00 || payload[currentOffset + 1] !== 0x00 || payload[currentOffset + 2] !== 0x01) {
          currentOffset += 1
          continue
        }
        break
      }

      let payloadLength = currentOffset - startOffset

      // 如果是 0x00000001 则需要修正 payloadLength
      if (payload[currentOffset - 1] === 0x00) {
        payloadLength -= 1
      }

      if (payloadLength !== 0) {
        const naluData = payload.slice(startOffset, startOffset + payloadLength)
        nalUnits.push({ type: naluType, data: naluData })
      }
    }

    return nalUnits
  }

  /**
   * 解析 PTS/DTS 时间戳（33-bit，单位：90kHz）
   */
  private parsePtsDts = (view: DataView, offset: number): number => {
    return ((view.getUint8(offset) & 0x0e) << 29) | (view.getUint8(offset + 1) << 22) | ((view.getUint8(offset + 2) & 0xfe) << 14) | (view.getUint8(offset + 3) << 7) | ((view.getUint8(offset + 4) & 0xfe) >> 1)
  }

  private decodeIDRFrames = (nalus: Array<{ type: number; data: Uint8Array }>) => {
    // 合并所有 IDR NALU 数据
    const idrData = new Uint8Array(nalus.filter((n) => n.type === 5).reduce((sum, n) => sum + n.data.length, 0))
    let offset = 0
    nalus.forEach((nalu) => {
      if (nalu.type === 5) {
        idrData.set(nalu.data, offset)
        offset += nalu.data.length
      }
    })
    return idrData
  }
}
