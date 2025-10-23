import type { On as TsOn } from './ts264Parser'

export type Pattern = 'hls' | 'dash' | 'rtmp' | 'flv'
export type TagType = 'script' | 'audio' | 'video'

export interface Header {
  signature: string
  version: number
  flags: {
    audio: Boolean
    video: Boolean
  }
  dataOffset: number
}

export interface Nalu {
  size: number
  header: {
    forbidden_zero_bit: number
    nal_ref_idc: number
    nal_unit_type: number
  }
  payload: Uint8Array
}

export interface ScriptTag {
  header: {
    tagType: 'script'
    dataSize: number
    timestamp: number
    timestampExtended: number
    streamID: number
  }
  body: {
    soundFormat: string
    soundRate: string
    soundSize: string
    soundType: string
    data: Uint8Array
  }
}

export interface AudioTag {
  header: {
    tagType: 'audio'
    dataSize: number
    timestamp: number
    timestampExtended: number
    streamID: number
  }
  body: {
    soundFormat: string
    soundRate: string
    soundSize: string
    soundType: string
    data: Uint8Array
  }
}

export interface VideoTag {
  header: {
    tagType: 'video'
    dataSize: number
    timestamp: number
    timestampExtended: number
    streamID: number
  }
  body: {
    frameType: number
    codecID: number
    avcPacketType: number
    cts: number
    data: Uint8Array
    nalus: Nalu[]
    version?: string
    codec?: string
  }
}

// PS、RTP、TS、ES
export interface On {
  header?: (_header: Header) => void
  tag?: (_tag: ScriptTag | AudioTag | VideoTag) => void
  ts?: TsOn
}
