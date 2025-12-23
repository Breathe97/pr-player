import { Decoder } from './Decoder'

interface WorkerMessage {
  action: 'init' | 'initAudio' | 'initVideo' | 'push' | 'setFrameTrack' | 'destroy'
  data: never
}

const decoder = new Decoder()

// @ts-ignore
decoder.on.audio.decode = (data) => postMessage({ action: 'on.audio.decode', data }, [data.audioData])
decoder.on.audio.error = (data) => postMessage({ action: 'on.audio.error', data })

// @ts-ignore
decoder.on.video.decode = (data: { timestamp: number; bitmap: ImageBitmap }) => postMessage({ action: 'on.video.decode', data }, [data.bitmap])
decoder.on.video.error = (data) => postMessage({ action: 'on.video.error', data })

decoder.on.nalus = (data) => postMessage({ action: 'on.nalus', data })
decoder.on.analysis = (data) => postMessage({ action: 'on.analysis', data })

onmessage = (event: MessageEvent<WorkerMessage>) => {
  const { action, data } = event.data
  const func = decoder[action]
  func && func(data)
}
