import { RenderWorker } from './render/RenderWorker'

export const getFormatFromUrlPattern = (url: string) => {
  const lowerUrl = url.toLowerCase()

  // HLS 检测
  if (lowerUrl.includes('.m3u8') || lowerUrl.includes('hls') || lowerUrl.includes('master.m3u8') || lowerUrl.match(/index\d*\.m3u8/)) {
    return 'hls'
  }

  // DASH 检测
  if (lowerUrl.includes('.mpd') || lowerUrl.includes('dash')) {
    return 'dash'
  }

  // RTMP 检测
  if (lowerUrl.startsWith('rtmp://') || lowerUrl.startsWith('rtmps://')) {
    return 'rtmp'
  }

  // HTTP-FLV 检测
  if (lowerUrl.includes('.flv') || (lowerUrl.includes('flv') && !lowerUrl.includes('flash'))) {
    return 'flv'
  }

  return 'unknown'
}

export const stopStream = (stream: MediaStream | undefined) => {
  const tracks = stream?.getTracks() || []
  for (const track of tracks) {
    track.stop()
  }
}

export const createRender = () => {
  const worker = new RenderWorker()

  const canvas = document.createElement('canvas')
  const offscreenCanvas = canvas.transferControlToOffscreen()

  // @ts-ignore
  const trackGenerator = new MediaStreamTrackGenerator({ kind: 'video' })

  const stream = new MediaStream([trackGenerator])

  const destroy = () => {
    worker.destroy()
    stopStream(stream)
  }
  worker.init({ offscreenCanvas, writable: trackGenerator.writable })

  return { worker, canvas, stream, destroy }
}
