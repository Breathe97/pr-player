export const createAVCC = (sps: Uint8Array, pps: Uint8Array) => {
  // AVCC 格式：https://wiki.multimedia.cx/index.php/AVC1
  // [版本][profile][兼容性][level][长度大小] + [SPS数量] + [SPS长度] + [SPS数据] + [PPS数量] + [PPS长度] + [PPS数据]

  const spsData = new Uint8Array(sps)
  const ppsData = new Uint8Array(pps)

  const avcc = new Uint8Array(11 + spsData.length + ppsData.length)
  let offset = 0

  // 配置版本
  avcc[offset++] = 0x01 // version

  // profile, compatibility, level 从 SPS 获取
  avcc[offset++] = spsData[1] // profile_idc
  avcc[offset++] = spsData[2] // compatibility
  avcc[offset++] = spsData[3] // level_idc

  // NALU 长度大小 - 1（通常为3，表示4字节长度）
  avcc[offset++] = (0xff & 0xfc) | 0x03 // 0b11111100 | 0x03 = 长度大小为4字节

  // SPS 数量（通常为1）
  avcc[offset++] = 0xe1 // 0b11100001（1个SPS）

  // SPS 长度（大端序）
  avcc[offset++] = (spsData.length >> 8) & 0xff
  avcc[offset++] = spsData.length & 0xff

  // SPS 数据
  avcc.set(spsData, offset)
  offset += spsData.length

  // PPS 数量（通常为1）
  avcc[offset++] = 0x01 // 1个PPS

  // PPS 长度（大端序）
  avcc[offset++] = (ppsData.length >> 8) & 0xff
  avcc[offset++] = ppsData.length & 0xff

  // PPS 数据
  avcc.set(ppsData, offset)

  return avcc
}

export const parseAVCC = (avcc: Uint8Array) => {
  let currentOffset = 0
  const view = new DataView(avcc.buffer)

  // [0]字节 固定为1（H.264标准要求）
  const version = view.getUint8(currentOffset)
  currentOffset = currentOffset + 1
  if (version !== 1) throw new Error('Invalid AVC version')

  // [1]字节 编码档次（Profile），如0x64=High Profile、0x66=Baseline Profile
  const profile = view.getUint8(currentOffset) & 0xff
  currentOffset = currentOffset + 1

  // [2]字节 兼容性标志（与Profile配合使用）
  const compatibility = view.getUint8(currentOffset) & 0xff
  currentOffset = currentOffset + 1

  // [3]字节 编码级别（Level），如0x31=3.1 Level
  const level = view.getUint8(currentOffset) & 0xff
  currentOffset = currentOffset + 1

  const arr = Array.from([profile, compatibility, level], (item) => item.toString(16).padStart(2, '0'))
  const str = arr.join('')
  const codec = `avc1.${str}`

  // [4]字节 低2位 NALU长度前缀的字节数减1（如0x03=4字节长度前缀）
  const lengthSizeMinusOne = (view.getUint8(currentOffset) & 0x03) - 1
  currentOffset = currentOffset + 1

  // [5]字节 低5位 SPS数量（通常为1）
  const numOfSequenceParameterSets = view.getUint8(currentOffset) & 0x1f
  currentOffset = currentOffset + 1

  // [6，7]字节 SPS的总长度（大端序）
  const sequenceParameterSetLength = view.getUint16(currentOffset, false)
  currentOffset = currentOffset + 2

  // [8,...sequenceParameterSetLength]字节 SPS数据（长度为sequenceParameterSetLength）
  const sps = new Uint8Array(view.buffer.slice(currentOffset, currentOffset + sequenceParameterSetLength))
  currentOffset = currentOffset + sequenceParameterSetLength

  // [0]字节 低5位 PPS数量（通常为1）
  const numOfPictureParameterSets = view.getUint8(currentOffset) & 0x1f
  currentOffset = currentOffset + 1

  // [1,2]字节 PPS的总长度（大端序）
  const pictureParameterSetLength = view.getUint16(currentOffset, false)
  currentOffset = currentOffset + 2

  // [3,...pictureParameterSetLength]字节	PPS数据（长度为pictureParameterSetLength）
  const pps = new Uint8Array(view.buffer.slice(currentOffset, currentOffset + pictureParameterSetLength))
  currentOffset = currentOffset + pictureParameterSetLength

  return { version, codec, profile, compatibility, level, lengthSizeMinusOne, numOfSequenceParameterSets, sequenceParameterSetLength, sps, numOfPictureParameterSets, pictureParameterSetLength, pps }
}

export const naluToAVCC = (nalu: Uint8Array): Uint8Array => {
  const avccNALU = new Uint8Array(4 + nalu.length)

  // 写入4字节长度前缀（大端序）
  new DataView(avccNALU.buffer).setUint32(0, nalu.length, false)

  // 写入NALU数据
  avccNALU.set(nalu, 4)

  return avccNALU
}

export const mergeNalus = (nalus: Uint8Array[]): Uint8Array => {
  // 计算总长度
  let totalLength = 0
  for (const nalu of nalus) {
    totalLength += nalu.length // 4字节长度前缀 + NALU数据
  }

  // 创建输出缓冲区
  const avccData = new Uint8Array(totalLength)
  let offset = 0

  // 逐个转换NALU
  for (const nalu of nalus) {
    const avccNalu = nalu
    avccData.set(avccNalu, offset)
    offset += avccNalu.length
  }

  return avccData
}

export const parseNalu = (nalu: Uint8Array) => {
  const view = new DataView(nalu.buffer)

  let currentOffset = 0

  let size, header, data

  // NALU长度
  {
    size = view.getUint32(currentOffset, false)
    currentOffset += 4
  }

  // NALU Header
  {
    const num = view.getUint8(currentOffset)

    const forbidden_zero_bit = (num >> 7) & 0x01 // 必为0
    const nal_ref_idc = (num >> 5) & 0x03 // 参考优先级（0-3）
    const nal_unit_type = num & 0x1f // NALU类型（1-31）

    header = { forbidden_zero_bit, nal_ref_idc, nal_unit_type }
    currentOffset += 1
  }

  {
    const dataLength = size - 1
    data = new Uint8Array(view.buffer.slice(currentOffset, currentOffset + dataLength))
  }

  return { size, header, data }
}
