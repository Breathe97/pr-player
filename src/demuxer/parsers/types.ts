export interface AudioConfig {
  kind: 'audio'
  codec: string
  sampleRate: number
  numberOfChannels: number
  description?: Uint8Array
}

export interface VideoConfig {
  kind: 'video'
  codec: string
  sps: Uint8Array
  pps: Uint8Array
  description: Uint8Array
}
