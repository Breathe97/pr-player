type DebugEntry = {
  t: number
  cat: string
  event: string
  data?: unknown
}

const sanitize = (value: unknown, depth = 0): unknown => {
  if (value == null || depth > 4) return value
  if (value instanceof Uint8Array) {
    const hex = Array.from(value.slice(0, 16))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(' ')
    return { type: 'Uint8Array', byteLength: value.byteLength, preview: hex }
  }
  if (value instanceof ArrayBuffer) return { type: 'ArrayBuffer', byteLength: value.byteLength }
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack }
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitize(item, depth + 1))
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === 'data' || k === 'description' || k === 'sps' || k === 'pps' || k === 'nalus') {
        out[k] = sanitize(v, depth + 1)
      } else {
        out[k] = sanitize(v, depth + 1)
      }
    }
    return out
  }
  return value
}

class PrPlayerDebugSession {
  active = false
  label = ''
  startedAt = 0
  logs: DebugEntry[] = []
  counts = {
    pushBytes: 0,
    demuxerInfo: 0,
    demuxerConfig: 0,
    demuxerChunkVideo: 0,
    demuxerChunkAudio: 0,
    demuxerDebug: 0,
    decoderAudio: 0,
    decoderVideo: 0,
    errors: 0
  }
  meta: Record<string, unknown> = {}

  start = (label = '') => {
    this.active = true
    this.label = label
    this.startedAt = Date.now()
    this.logs = []
    this.counts = {
      pushBytes: 0,
      demuxerInfo: 0,
      demuxerConfig: 0,
      demuxerChunkVideo: 0,
      demuxerChunkAudio: 0,
      demuxerDebug: 0,
      decoderAudio: 0,
      decoderVideo: 0,
      errors: 0
    }
    this.meta = { label, startedAt: new Date(this.startedAt).toISOString() }
    this.log('session', 'start', { label })
    console.log('[pr-player-debug] session started', label || '(no label)')
  }

  end = () => {
    if (!this.active) {
      console.warn('[pr-player-debug] no active session, call start() first')
      return
    }
    this.active = false
    const endedAt = Date.now()
    const payload = {
      meta: {
        ...this.meta,
        endedAt: new Date(endedAt).toISOString(),
        durationMs: endedAt - this.startedAt
      },
      counts: this.counts,
      logs: this.logs
    }
    this.log('session', 'end', { durationMs: endedAt - this.startedAt })
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const name = this.label ? `pr-player-debug-${this.label}` : 'pr-player-debug'
    a.href = url
    a.download = `${name}-${endedAt}.json`
    a.click()
    URL.revokeObjectURL(url)
    console.log('[pr-player-debug] session ended, json downloaded', payload.counts)
    return payload
  }

  setMeta = (data: Record<string, unknown>) => {
    this.meta = { ...this.meta, ...sanitize(data) as Record<string, unknown> }
  }

  log = (cat: string, event: string, data?: unknown) => {
    if (!this.active) return
    this.logs.push({ t: Date.now() - this.startedAt, cat, event, data: sanitize(data) })
  }

  error = (cat: string, event: string, data?: unknown) => {
    this.counts.errors += 1
    this.log(cat, event, data)
  }
}

let session = new PrPlayerDebugSession()

export const prPlayerDebug = {
  start: (label?: string) => session.start(label),
  end: () => session.end(),
  log: (cat: string, event: string, data?: unknown) => session.log(cat, event, data),
  error: (cat: string, event: string, data?: unknown) => session.error(cat, event, data),
  setMeta: (data: Record<string, unknown>) => session.setMeta(data),
  bump: (key: keyof typeof session.counts) => {
    if (session.active) session.counts[key] += 1
  },
  getCount: (key: keyof typeof session.counts) => session.counts[key],
  isActive: () => session.active
}

declare global {
  interface Window {
    start: (label?: string) => void
    end: () => unknown
    prPlayerDebug: typeof prPlayerDebug
  }
}

export const attachPrPlayerDebug = () => {
  if (typeof window === 'undefined') return
  window.prPlayerDebug = prPlayerDebug
  window.start = (label?: string) => prPlayerDebug.start(label)
  window.end = () => prPlayerDebug.end()
}
