export interface MpdByteRange {
  start: number
  end: number
}

export interface MpdSegmentTemplate {
  initialization?: string
  media?: string
  timescale: number
  duration: number
  startNumber: number
}

export interface MpdSegmentListInfo {
  timescale: number
  duration: number
  initRange?: MpdByteRange
  segments: MpdByteRange[]
}

export interface MpdRepresentation {
  id: string
  codecs: string
  bandwidth: number
  width?: number
  height?: number
  baseUrl?: string
  template?: MpdSegmentTemplate
  segmentList?: MpdSegmentListInfo
}

export interface MpdAdaptation {
  kind: 'video' | 'audio' | 'mux'
  mimeType: string
  representation: MpdRepresentation
}

export interface MpdInfo {
  isLive: boolean
  duration?: number
  baseUrl: string
  adaptations: MpdAdaptation[]
}

const getAttr = (tag: string, name: string) => {
  const m = tag.match(new RegExp(`${name}="([^"]*)"`, 'i'))
  return m?.[1]
}

const parseRange = (range: string): MpdByteRange => {
  const [start, end] = range.split('-').map((v) => parseInt(v, 10))
  return { start, end }
}

const parseDuration = (value?: string) => {
  if (!value) return undefined
  const m = value.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?/i)
  if (!m) return undefined
  const hours = parseInt(m[1] || '0', 10)
  const minutes = parseInt(m[2] || '0', 10)
  const seconds = parseFloat(m[3] || '0')
  return hours * 3600 + minutes * 60 + seconds
}

export const resolveUrl = (baseUrl: string, href: string) => {
  if (!href) return baseUrl
  if (/^https?:\/\//i.test(href)) return href
  if (href.startsWith('/')) {
    const origin = baseUrl.match(/^(https?:\/\/[^/]+)/i)?.[1]
    return origin ? `${origin}${href}` : href
  }
  return baseUrl + href
}

const expandTemplate = (template: string, vars: Record<string, string | number>) => {
  return template.replace(/\$(RepresentationID|\w+)(?:%0(\d+)d)?\$/g, (_, key, pad) => {
    const val = vars[key] ?? vars[key.toLowerCase()] ?? ''
    if (pad) return String(val).padStart(Number(pad), '0')
    return String(val)
  })
}

export const buildSegmentUrl = (baseUrl: string, template: string, vars: Record<string, string | number>) =>
  resolveUrl(baseUrl, expandTemplate(template, vars))

const parseSegmentList = (repBody: string, adaptBody: string): MpdSegmentListInfo | undefined => {
  const segListMatch =
    repBody.match(/<SegmentList([^>]*)>([\s\S]*?)<\/SegmentList>/i) ||
    adaptBody.match(/<SegmentList([^>]*)>([\s\S]*?)<\/SegmentList>/i)
  if (!segListMatch) return undefined

  const segListAttrs = segListMatch[1]
  const segListBody = segListMatch[2]
  const initMatch = segListBody.match(/<Initialization[^>]*range="([^"]+)"/i)
  const segments: MpdByteRange[] = []
  const segUrlRegex = /<SegmentURL[^>]*mediaRange="([^"]+)"/gi
  let match
  while ((match = segUrlRegex.exec(segListBody))) {
    segments.push(parseRange(match[1]))
  }
  if (segments.length === 0 && !initMatch) return undefined

  return {
    timescale: parseInt(getAttr(segListAttrs, 'timescale') || '1000', 10),
    duration: parseInt(getAttr(segListAttrs, 'duration') || '0', 10),
    initRange: initMatch ? parseRange(initMatch[1]) : undefined,
    segments
  }
}

const parseSegmentTemplate = (repBody: string, adaptBody: string): MpdSegmentTemplate | undefined => {
  const segTemplateTag =
    repBody.match(/<SegmentTemplate([^>]*)\/>/i)?.[1] ||
    repBody.match(/<SegmentTemplate([^>]*)>/i)?.[1] ||
    adaptBody.match(/<SegmentTemplate([^>]*)\/>/i)?.[1] ||
    adaptBody.match(/<SegmentTemplate([^>]*)>/i)?.[1] ||
    ''

  if (!segTemplateTag) {
    const segmentUrl = repBody.match(/<SegmentURL[^>]*initialization="([^"]*)"[^>]*media="([^"]*)"/i)
    if (!segmentUrl) return undefined
    return {
      initialization: segmentUrl[1],
      media: segmentUrl[2],
      timescale: 1000,
      duration: 0,
      startNumber: 1
    }
  }

  return {
    initialization: getAttr(segTemplateTag, 'initialization'),
    media: getAttr(segTemplateTag, 'media'),
    timescale: parseInt(getAttr(segTemplateTag, 'timescale') || '1000', 10),
    duration: parseInt(getAttr(segTemplateTag, 'duration') || '0', 10),
    startNumber: parseInt(getAttr(segTemplateTag, 'startNumber') || '1', 10)
  }
}

export const parseMpd = (xml: string, mpdUrl: string): MpdInfo => {
  const baseUrl = mpdUrl.substring(0, mpdUrl.lastIndexOf('/') + 1)
  const mpdTag = xml.match(/<MPD[^>]*>/i)?.[0] || ''
  const type = getAttr(mpdTag, 'type') || 'static'
  const isLive = type === 'dynamic'
  const duration = parseDuration(getAttr(mpdTag, 'mediaPresentationDuration'))

  const adaptations: MpdAdaptation[] = []
  const adaptationRegex = /<AdaptationSet([^>]*)>([\s\S]*?)<\/AdaptationSet>/gi
  let adaptMatch

  while ((adaptMatch = adaptationRegex.exec(xml))) {
    const adaptAttrs = adaptMatch[1]
    const adaptBody = adaptMatch[2]
    const mimeType = getAttr(adaptAttrs, 'mimeType') || ''
    const contentType = getAttr(adaptAttrs, 'contentType') || ''
    const hasVideo =
      mimeType.includes('video') ||
      contentType === 'video' ||
      /<ContentComponent[^>]*contentType="video"/i.test(adaptBody)
    const hasAudio =
      mimeType.includes('audio') ||
      contentType === 'audio' ||
      /<ContentComponent[^>]*contentType="audio"/i.test(adaptBody)

    let kind: 'video' | 'audio' | 'mux' | undefined
    if (hasVideo && hasAudio) kind = 'mux'
    else if (hasVideo) kind = 'video'
    else if (hasAudio) kind = 'audio'
    if (!kind) continue

    const repMatch = adaptBody.match(/<Representation([^>]*)(?:\/>|>([\s\S]*?)<\/Representation>)/i)
    if (!repMatch) continue

    const repAttrs = repMatch[1]
    const repBody = repMatch[2] || ''
    const id = getAttr(repAttrs, 'id') || '0'
    const codecs = getAttr(repAttrs, 'codecs') || ''
    const bandwidth = parseInt(getAttr(repAttrs, 'bandwidth') || '0', 10)
    const width = parseInt(getAttr(repAttrs, 'width') || '0', 10) || undefined
    const height = parseInt(getAttr(repAttrs, 'height') || '0', 10) || undefined
    const repBaseUrl = repBody.match(/<BaseURL>([^<]+)<\/BaseURL>/i)?.[1]?.trim()

    const segmentList = parseSegmentList(repBody, adaptBody)
    const template = segmentList ? undefined : parseSegmentTemplate(repBody, adaptBody)
    if (!segmentList && (!template || (!template.media && !template.initialization))) continue

    adaptations.push({
      kind,
      mimeType: mimeType || (hasVideo ? 'video/mp4' : 'audio/mp4'),
      representation: { id, codecs, bandwidth, width, height, baseUrl: repBaseUrl, template, segmentList }
    })
  }

  return { isLive, duration, baseUrl, adaptations }
}
