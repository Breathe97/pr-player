// fMP4 / 渐进式 MP4 解析（DASH、.mp4）

import type { Chunk } from '../Cacher'
import { parseAVCC } from './264Parser'
import type { AudioConfig, VideoConfig } from './types'
import { findBox, findSampleEntryChild, forEachBox, readBoxAt, readBoxType, type BoxInfo } from './boxParser'

const AAC_SAMPLE_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350]

interface On {
  info?: (_info: any) => void
  config?: (_config: AudioConfig | VideoConfig) => void
  chunk?: (_chunk: Chunk) => void
}

interface TrackInfo {
  kind: 'video' | 'audio'
  trackId: number
  timescale: number
  width?: number
  height?: number
  /** mvex/trex 中的默认 sample 时长（timescale 单位） */
  defaultSampleDuration?: number
  defaultSampleSize?: number
}

const readDescLength = (data: Uint8Array, offset: number) => {
  let len = 0
  let i = offset
  while (i < data.length) {
    len = (len << 7) | (data[i] & 0x7f)
    if ((data[i] & 0x80) === 0) return { len, next: i + 1 }
    i++
  }
  return { len: 0, next: offset }
}

export class ParseFMP4 {
  audioConfig?: AudioConfig
  videoConfig?: VideoConfig

  private tracks = new Map<number, TrackInfo>()
  private mdatBox: BoxInfo | null = null
  private progressiveParsed = false

  public on: On = {}

  /** moov-at-end 的 MP4 在 sample 提取完成前不能丢弃 buffer */
  getDiscardOffset = (bufferLength: number, view: DataView) => {
    if (this.progressiveParsed) return bufferLength
    // DASH fMP4 分片（moof+mdat）或纯 init（moov）
    if (findBox(view, 0, bufferLength, 'moof')) return bufferLength
    if (this.tracks.size > 0 && !findBox(view, 0, bufferLength, 'mdat')) return bufferLength
    return 0
  }

  constructor() {}

  parse = async (view: DataView) => {
    const buffer = new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
    const end = buffer.byteLength
    let offset = 0

    while (offset < end) {
      const box = readBoxAt(view, offset, end)
      if (!box) return 0

      switch (box.type) {
        case 'moov':
          this.parseMoov(view, box)
          this.tryRunProgressive(view, buffer)
          break
        case 'moof':
          this.parseMoof(view, box, buffer)
          break
        case 'mdat':
          this.mdatBox = box
          this.tryRunProgressive(view, buffer)
          break
        case 'sidx':
        case 'styp':
        case 'free':
        case 'skip':
        case 'ftyp':
          break
        default:
          break
      }

      offset += box.size
      if (box.type === 'moov' || box.type === 'moof' || box.type === 'mdat') {
        await new Promise((resolve) => setTimeout(() => resolve(true), 8))
      }
    }

    return this.progressiveParsed ? end : 0
  }

  private tryRunProgressive = (view: DataView, buffer: Uint8Array) => {
    if (this.progressiveParsed || this.tracks.size === 0) return

    const mdat = this.mdatBox ?? findBox(view, 0, buffer.byteLength, 'mdat')
    const moov = findBox(view, 0, buffer.byteLength, 'moov')
    if (!mdat || !moov) return
    if (!this.isProgressiveReady(mdat, moov, buffer.byteLength)) return

    this.parseProgressive(view, mdat, buffer)
    this.progressiveParsed = true
  }

  private isProgressiveReady = (mdat: BoxInfo, moov: BoxInfo, bufferLength: number) => {
    return mdat.offset + mdat.size <= bufferLength && moov.offset + moov.size <= bufferLength
  }

  private parseMoov = (view: DataView, moov: BoxInfo) => {
    forEachBox(view, moov.contentStart, moov.offset + moov.size, (box) => {
      if (box.type !== 'trak') return
      this.parseTrak(view, box)
    })

    const mvex = findBox(view, moov.contentStart, moov.offset + moov.size, 'mvex')
    if (mvex) {
      forEachBox(view, mvex.contentStart, mvex.offset + mvex.size, (box) => {
        if (box.type !== 'trex') return
        const trackId = view.getUint32(box.contentStart + 4, false)
        const track = this.tracks.get(trackId)
        if (!track) return
        track.defaultSampleDuration = view.getUint32(box.contentStart + 12, false)
        track.defaultSampleSize = view.getUint32(box.contentStart + 16, false)
      })
    }

    const mvhd = findBox(view, moov.contentStart, moov.offset + moov.size, 'mvhd')
    if (mvhd) {
      const version = view.getUint8(mvhd.contentStart)
      const timescale = view.getUint32(mvhd.contentStart + (version === 1 ? 20 : 12), false)
      const duration = version === 1 ? Number(view.getBigUint64(mvhd.contentStart + 24, false)) : view.getUint32(mvhd.contentStart + 16, false)
      this.on.info?.({
        width: [...this.tracks.values()].find((t) => t.kind === 'video')?.width,
        height: [...this.tracks.values()].find((t) => t.kind === 'video')?.height,
        duration: timescale ? duration / timescale : undefined
      })
    }
  }

  private readTkhdSize = (view: DataView, tkhd: BoxInfo) => {
    const version = view.getUint8(tkhd.contentStart)
    const widthOffset = version === 1 ? 72 : 64
    const heightOffset = version === 1 ? 76 : 68
    return {
      width: view.getUint32(tkhd.contentStart + widthOffset, false) >> 16,
      height: view.getUint32(tkhd.contentStart + heightOffset, false) >> 16
    }
  }

  /** VisualSampleEntry 中的宽高（uint16，比 tkhd 更可靠） */
  private readSampleEntrySize = (view: DataView, entryStart: number) => ({
    width: view.getUint16(entryStart + 32, false),
    height: view.getUint16(entryStart + 34, false)
  })

  private parseTrak = (view: DataView, trak: BoxInfo) => {
    const tkhd = findBox(view, trak.contentStart, trak.offset + trak.size, 'tkhd')
    const mdia = findBox(view, trak.contentStart, trak.offset + trak.size, 'mdia')
    if (!tkhd || !mdia) return

    const version = view.getUint8(tkhd.contentStart)
    const trackId = view.getUint32(tkhd.contentStart + (version === 1 ? 20 : 12), false)
    let { width, height } = this.readTkhdSize(view, tkhd)

    const hdlr = findBox(view, mdia.contentStart, mdia.offset + mdia.size, 'hdlr')
    const mdhd = findBox(view, mdia.contentStart, mdia.offset + mdia.size, 'mdhd')
    if (!hdlr || !mdhd) return

    const handler = readBoxType(view, hdlr.contentStart + 8)
    const kind = handler === 'vide' ? 'video' : handler === 'soun' ? 'audio' : undefined
    if (!kind) return

    const mdhdVersion = view.getUint8(mdhd.contentStart)
    const timescale = view.getUint32(mdhd.contentStart + (mdhdVersion === 1 ? 20 : 12), false)

    this.tracks.set(trackId, { kind, trackId, timescale, width, height })

    const minf = findBox(view, mdia.contentStart, mdia.offset + mdia.size, 'minf')
    const stbl = minf && findBox(view, minf.contentStart, minf.offset + minf.size, 'stbl')
    const stsd = stbl && findBox(view, stbl.contentStart, stbl.offset + stbl.size, 'stsd')
    if (!stsd) return

    const entryStart = stsd.contentStart + 8
    const entrySize = view.getUint32(entryStart, false)
    const entryEnd = entryStart + entrySize
    const entryFormat = readBoxType(view, entryStart + 4)

    if (kind === 'video' && (entryFormat === 'avc1' || entryFormat === 'avc3')) {
      const fromEntry = this.readSampleEntrySize(view, entryStart)
      if (fromEntry.width && fromEntry.height) {
        width = fromEntry.width
        height = fromEntry.height
      }

      const avcC = findSampleEntryChild(view, entryStart, entryEnd, 'avcC', 86)
      if (!avcC) return
      const avcc = new Uint8Array(view.buffer, avcC.contentStart, avcC.size - avcC.headerSize)
      const config = parseAVCC(avcc)
      const codec = config.codec.replace(/^avc1\./, `${entryFormat}.`)
      this.videoConfig = { kind: 'video', codec, description: avcc, sps: config.sps, pps: config.pps }
      this.on.config?.(this.videoConfig)
    }

    if (kind === 'video') {
      const track = this.tracks.get(trackId)
      if (track) {
        track.width = width
        track.height = height
      }
    }

    if (kind === 'audio' && entryFormat === 'mp4a') {
      const esds = findSampleEntryChild(view, entryStart, entryEnd, 'esds', 36)
      const audioConfig = esds && this.parseEsds(view, esds)
      if (audioConfig) {
        this.audioConfig = audioConfig
        this.on.config?.(audioConfig)
      }
    }
  }

  private parseEsds = (view: DataView, esds: BoxInfo): AudioConfig | null => {
    const data = new Uint8Array(view.buffer, esds.contentStart, esds.size - esds.headerSize)
    for (let i = 0; i < data.length - 2; i++) {
      if (data[i] !== 0x05) continue
      const { len, next } = readDescLength(data, i + 1)
      if (len < 2 || next + len > data.length) continue
      const asc = data.slice(next, next + len)
      const num = asc[0]
      const num1 = asc[1]
      const audioObjectType = (num >> 3) & 0x1f
      const samplingFrequencyIndex = ((num & 0x07) << 1) | (num1 >> 7)
      const channelConfiguration = (num1 >> 3) & 0x0f
      return {
        kind: 'audio',
        codec: `mp4a.40.${audioObjectType}`,
        sampleRate: AAC_SAMPLE_RATES[samplingFrequencyIndex] ?? 44100,
        numberOfChannels: channelConfiguration,
        description: asc
      }
    }
    return null
  }

  private findMdatForMoof = (view: DataView, moof: BoxInfo, bufferLength: number): BoxInfo | null => {
    let offset = moof.offset + moof.size
    while (offset + 8 <= bufferLength) {
      const box = readBoxAt(view, offset, bufferLength)
      if (!box) break
      if (box.type === 'moof') break
      if (box.type === 'mdat') return box
      offset += box.size
    }
    return null
  }

  private parseMoof = (view: DataView, moof: BoxInfo, buffer: Uint8Array) => {
    const mdat = this.findMdatForMoof(view, moof, buffer.byteLength)
    if (!mdat) return

    forEachBox(view, moof.contentStart, moof.offset + moof.size, (box) => {
      if (box.type !== 'traf') return
      this.parseTraf(view, box, moof.offset, mdat, buffer)
    })
  }

  private ticksToMs = (ticks: number, timescale: number) => (ticks / timescale) * 1000

  /** ctts：每个 sample 的 composition offset（timescale 单位） */
  private readCttsOffsets = (view: DataView, ctts: BoxInfo | null, sampleCount: number) => {
    const offsets = new Int32Array(sampleCount)
    if (!ctts || sampleCount === 0) return offsets

    const entryCount = view.getUint32(ctts.contentStart + 4, false)
    let entryIndex = 0
    let entryLeft = 0
    let entryOffset = 0
    let pos = ctts.contentStart + 8

    for (let i = 0; i < sampleCount; i++) {
      if (entryLeft === 0 && entryIndex < entryCount) {
        entryLeft = view.getUint32(pos, false)
        entryOffset = view.getInt32(pos + 4, false)
        pos += 8
        entryIndex++
      }
      offsets[i] = entryOffset
      entryLeft -= 1
    }
    return offsets
  }

  private parseTraf = (view: DataView, traf: BoxInfo, moofStart: number, mdat: BoxInfo, buffer: Uint8Array) => {
    const tfhd = findBox(view, traf.contentStart, traf.offset + traf.size, 'tfhd')
    const tfdt = findBox(view, traf.contentStart, traf.offset + traf.size, 'tfdt')
    const trun = findBox(view, traf.contentStart, traf.offset + traf.size, 'trun')
    if (!tfhd || !tfdt || !trun) return

    const trackId = view.getUint32(tfhd.contentStart + 4, false)
    const track = this.tracks.get(trackId)
    if (!track) return

    const tfhdWord = view.getUint32(tfhd.contentStart, false)
    const tfhdFlags = tfhdWord & 0xffffff
    const defaultBaseIsMoof = (tfhdFlags & 0x020000) !== 0

    let tfhdOffset = tfhd.contentStart + 8
    let baseDataOffset: number | null = null
    let defaultSampleDuration = 0
    let defaultSampleSize = 0

    if (tfhdFlags & 0x1) {
      baseDataOffset = Number(view.getBigUint64(tfhdOffset, false))
      tfhdOffset += 8
    }
    if (tfhdFlags & 0x2) tfhdOffset += 4
    if (tfhdFlags & 0x8) {
      defaultSampleDuration = view.getUint32(tfhdOffset, false)
      tfhdOffset += 4
    }
    if (tfhdFlags & 0x10) {
      defaultSampleSize = view.getUint32(tfhdOffset, false)
      tfhdOffset += 4
    }
    if (tfhdFlags & 0x20) tfhdOffset += 4

    if (!(tfhdFlags & 0x8)) defaultSampleDuration = track.defaultSampleDuration ?? 0
    if (!(tfhdFlags & 0x10)) defaultSampleSize = track.defaultSampleSize ?? 0

    const tfdtVersion = view.getUint8(tfdt.contentStart)
    const baseTime = tfdtVersion === 1 ? Number(view.getBigUint64(tfdt.contentStart + 4, false)) : view.getUint32(tfdt.contentStart + 4, false)

    const trunFlags = view.getUint32(trun.contentStart, false) & 0xffffff
    const trunEnd = trun.offset + trun.size
    let trunOffset = trun.contentStart + 4

    if (trunOffset + 4 > trunEnd) return
    const sampleCount = view.getUint32(trunOffset, false)
    trunOffset += 4

    if (sampleCount === 0 || sampleCount > 10000) return

    let dataOffset = 0
    if (trunFlags & 0x1) {
      if (trunOffset + 4 > trunEnd) return
      dataOffset = view.getInt32(trunOffset, false)
      trunOffset += 4
    }
    if (trunFlags & 0x4) trunOffset += 4

    let sampleBase: number
    if (defaultBaseIsMoof) {
      sampleBase = moofStart
    } else if (baseDataOffset !== null) {
      sampleBase = baseDataOffset
    } else {
      sampleBase = mdat.offset
    }
    let sampleOffset = sampleBase + (trunFlags & 0x1 ? dataOffset : 0)
    let dts = baseTime

    for (let i = 0; i < sampleCount; i++) {
      let sampleDuration = defaultSampleDuration
      let sampleSize = defaultSampleSize
      let sampleFlags = 0

      if (trunFlags & 0x100) {
        if (trunOffset + 4 > trunEnd) break
        sampleDuration = view.getUint32(trunOffset, false)
        trunOffset += 4
      }
      if (trunFlags & 0x200) {
        if (trunOffset + 4 > trunEnd) break
        sampleSize = view.getUint32(trunOffset, false)
        trunOffset += 4
      }
      if (trunFlags & 0x400) {
        if (trunOffset + 4 > trunEnd) break
        sampleFlags = view.getUint32(trunOffset, false)
        trunOffset += 4
      }
      let compositionOffset = 0
      if (trunFlags & 0x800) {
        if (trunOffset + 4 > trunEnd) break
        compositionOffset = view.getInt32(trunOffset, false)
        trunOffset += 4
      }

      if (sampleDuration <= 0 && track.kind === 'audio') {
        const rate = this.audioConfig?.sampleRate ?? track.timescale
        sampleDuration = Math.round((1024 * track.timescale) / rate)
      }

      if (sampleSize <= 0) continue
      if (sampleOffset + sampleSize > buffer.byteLength) break

      const sampleData = buffer.slice(sampleOffset, sampleOffset + sampleSize)
      sampleOffset += sampleSize

      const dtsMs = this.ticksToMs(dts, track.timescale)
      const ptsMs = this.ticksToMs(dts + compositionOffset, track.timescale)
      const cts = ptsMs - dtsMs

      const isKey = track.kind === 'video' ? ((sampleFlags >> 16) & 0x1) === 0 || this.isAvccKeyFrame(sampleData) : true
      const type = isKey ? 'key' : 'delta'

      if (track.kind === 'video') {
        const nalus = this.splitAvccNalus(sampleData)
        this.on.chunk?.({ kind: 'video', type, dts: dtsMs, pts: ptsMs, cts, data: sampleData, nalus })
      } else {
        this.on.chunk?.({ kind: 'audio', type: 'key', dts: dtsMs, pts: ptsMs, cts, data: sampleData })
      }

      dts += sampleDuration
    }
  }

  private parseProgressive = (view: DataView, _mdat: BoxInfo, buffer: Uint8Array) => {
    const moov = findBox(view, 0, buffer.byteLength, 'moov')
    if (!moov) return

    const samples: Chunk[] = []

    forEachBox(view, moov.contentStart, moov.offset + moov.size, (box) => {
      if (box.type !== 'trak') return
      const trackSamples = this.collectProgressiveTrackSamples(view, box, buffer)
      samples.push(...trackSamples)
    })

    samples.sort((a, b) => a.dts - b.dts || (a.kind === 'video' ? -1 : 1))

    for (const chunk of samples) {
      this.on.chunk?.(chunk)
    }
  }

  private collectProgressiveTrackSamples = (view: DataView, trak: BoxInfo, buffer: Uint8Array): Chunk[] => {
    const chunks: Chunk[] = []
    const tkhd = findBox(view, trak.contentStart, trak.offset + trak.size, 'tkhd')
    const mdia = findBox(view, trak.contentStart, trak.offset + trak.size, 'mdia')
    if (!tkhd || !mdia) return chunks

    const trackId = view.getUint32(tkhd.contentStart + (view.getUint8(tkhd.contentStart) === 1 ? 20 : 12), false)
    const track = this.tracks.get(trackId)
    if (!track) return chunks

    const minf = findBox(view, mdia.contentStart, mdia.offset + mdia.size, 'minf')
    const stbl = minf && findBox(view, minf.contentStart, minf.offset + minf.size, 'stbl')
    if (!stbl) return chunks

    const stsz = findBox(view, stbl.contentStart, stbl.offset + stbl.size, 'stsz')
    const stco = findBox(view, stbl.contentStart, stbl.offset + stbl.size, 'stco')
    const co64 = findBox(view, stbl.contentStart, stbl.offset + stbl.size, 'co64')
    const stsc = findBox(view, stbl.contentStart, stbl.offset + stbl.size, 'stsc')
    const stts = findBox(view, stbl.contentStart, stbl.offset + stbl.size, 'stts')
    const stss = findBox(view, stbl.contentStart, stbl.offset + stbl.size, 'stss')
    const ctts = findBox(view, stbl.contentStart, stbl.offset + stbl.size, 'ctts')
    if (!stsz || (!stco && !co64) || !stts) return chunks

    const defaultSize = view.getUint32(stsz.contentStart + 4, false)
    const sampleCount = view.getUint32(stsz.contentStart + 8, false)
    const cttsOffsets = this.readCttsOffsets(view, ctts, sampleCount)
    const chunkCount = stco ? view.getUint32(stco.contentStart + 4, false) : view.getUint32(co64!.contentStart + 4, false)

    const readChunkOffset = (chunkIndex: number) => (stco ? view.getUint32(stco.contentStart + 8 + (chunkIndex - 1) * 4, false) : Number(view.getBigUint64(co64!.contentStart + 8 + (chunkIndex - 1) * 8, false)))

    const syncSet = new Set<number>()
    if (stss) {
      const syncCount = view.getUint32(stss.contentStart + 4, false)
      for (let i = 0; i < syncCount; i++) {
        syncSet.add(view.getUint32(stss.contentStart + 8 + i * 4, false))
      }
    }

    const stscEntries: { firstChunk: number; samplesPerChunk: number }[] = []
    if (stsc) {
      const entryCount = view.getUint32(stsc.contentStart + 4, false)
      for (let i = 0; i < entryCount; i++) {
        const base = stsc.contentStart + 8 + i * 12
        stscEntries.push({
          firstChunk: view.getUint32(base, false),
          samplesPerChunk: view.getUint32(base + 4, false)
        })
      }
    }

    const getSamplesPerChunk = (chunkIndex: number) => {
      if (stscEntries.length === 0) {
        return sampleCount === chunkCount ? 1 : Math.max(1, Math.ceil(sampleCount / chunkCount))
      }
      let samplesPerChunk = stscEntries[0].samplesPerChunk
      for (const entry of stscEntries) {
        if (entry.firstChunk <= chunkIndex) samplesPerChunk = entry.samplesPerChunk
        else break
      }
      return samplesPerChunk
    }

    let dts = 0
    let sttsOffset = stts.contentStart + 8
    const sttsCount = view.getUint32(stts.contentStart + 4, false)
    let sttsIndex = 0
    let sttsLeft = sttsCount > 0 ? view.getUint32(sttsOffset, false) : 0
    let sttsDur = sttsCount > 0 ? view.getUint32(sttsOffset + 4, false) : 0
    sttsOffset += 8

    let sampleIndex = 1
    for (let chunkIndex = 1; chunkIndex <= chunkCount && sampleIndex <= sampleCount; chunkIndex++) {
      const samplesInChunk = getSamplesPerChunk(chunkIndex)
      let chunkOffset = readChunkOffset(chunkIndex)

      for (let s = 0; s < samplesInChunk && sampleIndex <= sampleCount; s++, sampleIndex++) {
        const size = defaultSize === 0 ? view.getUint32(stsz.contentStart + 12 + (sampleIndex - 1) * 4, false) : defaultSize

        if (chunkOffset + size > buffer.byteLength) return chunks

        const sampleData = buffer.slice(chunkOffset, chunkOffset + size)
        chunkOffset += size

        const dtsMs = this.ticksToMs(dts, track.timescale)
        const cttsOffset = cttsOffsets[sampleIndex - 1] ?? 0
        const ptsMs = this.ticksToMs(dts + cttsOffset, track.timescale)
        const cts = ptsMs - dtsMs
        const isKey = track.kind === 'video' ? this.isAvccKeyFrame(sampleData) || syncSet.has(sampleIndex) || syncSet.size === 0 : true

        if (track.kind === 'video') {
          chunks.push({
            kind: 'video',
            type: isKey ? 'key' : 'delta',
            dts: dtsMs,
            pts: ptsMs,
            cts,
            data: sampleData,
            nalus: this.splitAvccNalus(sampleData)
          })
        } else {
          chunks.push({ kind: 'audio', type: 'key', dts: dtsMs, pts: ptsMs, cts, data: sampleData })
        }

        dts += sttsDur
        sttsLeft -= 1
        if (sttsLeft === 0 && sttsIndex + 1 < sttsCount) {
          sttsIndex += 1
          sttsOffset = stts.contentStart + 8 + sttsIndex * 8
          sttsLeft = view.getUint32(sttsOffset, false)
          sttsDur = view.getUint32(sttsOffset + 4, false)
        }
      }
    }

    return chunks
  }

  private isAvccKeyFrame = (data: Uint8Array) => {
    let offset = 0
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    while (offset + 4 <= data.byteLength) {
      const size = view.getUint32(offset, false)
      if (size <= 0 || offset + 4 + size > data.byteLength) break
      const nalType = data[offset + 4] & 0x1f
      if (nalType === 5) return true
      offset += 4 + size
    }
    return false
  }

  private splitAvccNalus = (data: Uint8Array) => {
    const nalus: Uint8Array[] = []
    let offset = 0
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    while (offset + 4 <= data.byteLength) {
      const size = view.getUint32(offset, false)
      if (size <= 0 || offset + 4 + size > data.byteLength) break
      nalus.push(data.slice(offset, offset + 4 + size))
      offset += 4 + size
    }
    return nalus
  }
}
