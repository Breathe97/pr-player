export const createAVCC = (sps: Uint8Array, pps: Uint8Array) => {
  const spsData = new Uint8Array(sps)
  const ppsData = new Uint8Array(pps)

  const avcc = new Uint8Array(11 + spsData.length + ppsData.length)
  let offset = 0

  avcc[offset++] = 0x01
  avcc[offset++] = spsData[1]
  avcc[offset++] = spsData[2]
  avcc[offset++] = spsData[3]
  avcc[offset++] = (0xff & 0xfc) | 0x03
  avcc[offset++] = 0xe1
  avcc[offset++] = (spsData.length >> 8) & 0xff
  avcc[offset++] = spsData.length & 0xff
  avcc.set(spsData, offset)
  offset += spsData.length
  avcc[offset++] = 0x01
  avcc[offset++] = (ppsData.length >> 8) & 0xff
  avcc[offset++] = ppsData.length & 0xff
  avcc.set(ppsData, offset)

  return avcc
}

export const parseAVCC = (avcc: Uint8Array) => {
  let currentOffset = 0
  const view = new DataView(avcc.buffer, avcc.byteOffset, avcc.byteLength)

  const version = view.getUint8(currentOffset)
  currentOffset = currentOffset + 1
  if (version !== 1) throw new Error('Invalid AVC version')

  const profile = view.getUint8(currentOffset) & 0xff
  currentOffset = currentOffset + 1
  const compatibility = view.getUint8(currentOffset) & 0xff
  currentOffset = currentOffset + 1
  const level = view.getUint8(currentOffset) & 0xff
  currentOffset = currentOffset + 1

  const arr = Array.from([profile, compatibility, level], (item) => item.toString(16).padStart(2, '0'))
  const codec = `avc1.${arr.join('')}`

  currentOffset = currentOffset + 1
  currentOffset = currentOffset + 1
  const sequenceParameterSetLength = view.getUint16(currentOffset, false)
  currentOffset = currentOffset + 2
  const sps = new Uint8Array(avcc.buffer, avcc.byteOffset + currentOffset, sequenceParameterSetLength)
  currentOffset = currentOffset + sequenceParameterSetLength
  currentOffset = currentOffset + 1
  const pictureParameterSetLength = view.getUint16(currentOffset, false)
  currentOffset = currentOffset + 2
  const pps = new Uint8Array(avcc.buffer, avcc.byteOffset + currentOffset, pictureParameterSetLength)

  return { version, codec, profile, compatibility, level, sps, pps }
}

export const naluToAVCC = (nalu: Uint8Array): Uint8Array => {
  const avccNALU = new Uint8Array(4 + nalu.length)
  new DataView(avccNALU.buffer).setUint32(0, nalu.length, false)
  avccNALU.set(nalu, 4)
  return avccNALU
}

export const mergeNalus = (nalus: Uint8Array[]): Uint8Array => {
  let totalLength = 0
  for (const nalu of nalus) totalLength += nalu.length
  const avccData = new Uint8Array(totalLength)
  let offset = 0
  for (const nalu of nalus) {
    avccData.set(nalu, offset)
    offset += nalu.length
  }
  return avccData
}

export const parseNalu = (nalu: Uint8Array) => {
  const view = new DataView(nalu.buffer, nalu.byteOffset, nalu.byteLength)
  let currentOffset = 0
  const size = view.getUint32(currentOffset, false)
  currentOffset += 4
  const num = view.getUint8(currentOffset)
  const header = {
    forbidden_zero_bit: (num >> 7) & 0x01,
    nal_ref_idc: (num >> 5) & 0x03,
    nal_unit_type: num & 0x1f
  }
  currentOffset += 1
  const data = new Uint8Array(nalu.buffer, nalu.byteOffset + currentOffset, size - 1)
  return { size, header, data }
}
