export interface Chunk {
  kind: 'audio' | 'video'
  type: 'key' | 'delta'
  cts: number | undefined
  dts: number
  pts: number | undefined
  data: Uint8Array
  nalus?: Uint8Array[]
}

export class Cacher {
  private pendingPayloads: Uint8Array[] = [] // 所有原始分段数据
  private payload = new Uint8Array(0) // 当前正在复解的原始数据
  private chunks: any[] = [] // 复解后的数据 用于p2p传输或重播使用

  push = (payload: Uint8Array) => {
    this.pendingPayloads.push(payload)
  }

  next = (offset: number = 0) => {
    this.payload = this.payload.slice(offset)

    const next_payload = this.pendingPayloads.shift()

    if (!next_payload) return false // 没有后续数据

    // 合并数据
    const _payload = new Uint8Array(this.payload.byteLength + next_payload.byteLength)

    _payload.set(this.payload, 0)
    _payload.set(next_payload, this.payload.byteLength)

    this.payload = _payload

    return new DataView(this.payload.buffer)
  }

  pushChunk = (chunk: any) => {
    this.chunks.push(chunk)
    // console.log('\x1b[38;2;0;151;255m%c%s\x1b[0m', 'color:#0097ff;', `------->Breathe: chunks`, this.chunks.length)
  }

  destroy = () => {
    this.pendingPayloads = []
    this.payload = new Uint8Array(0)
    this.chunks = []
  }
}
