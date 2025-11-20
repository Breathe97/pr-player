import { Decoder } from './Decoder'

interface WorkerMessage {
  action: 'init' | 'initAudio' | 'initVideo' | 'push' | 'setFrameTrack' | 'destroy'
  data: never
}

const decoder = new Decoder()

decoder.on.audio.decode = (data) => postMessage({ action: 'on.audio.decode', data })
decoder.on.audio.error = (data) => postMessage({ action: 'on.audio.error', data })

decoder.on.video.decode = (data) => postMessage({ action: 'on.video.decode', data })
decoder.on.video.error = (data) => postMessage({ action: 'on.video.error', data })
decoder.on.nalus = (data) => postMessage({ action: 'on.nalus', data })
decoder.on.debug = (data) => postMessage({ action: 'on.debug', data })

onmessage = (event: MessageEvent<WorkerMessage>) => {
  const { action, data } = event.data
  const func = decoder[action]
  func && func(data)
}
