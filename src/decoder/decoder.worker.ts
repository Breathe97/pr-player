import { Decoder } from './Decoder'

interface WorkerMessage {
  type: 'audio' | 'video'
  action: 'init' | 'decode' | 'flush' | 'destroy'
  data: any
}

const decoder = new Decoder()

decoder.on.audio.decode = (data) => postMessage({ type: 'audio', action: 'onDecode', data })
decoder.on.audio.error = (data) => postMessage({ type: 'audio', action: 'onError', data })

decoder.on.video.decode = (data) => postMessage({ type: 'video', action: 'onDecode', data })
decoder.on.video.error = (data) => postMessage({ type: 'video', action: 'onError', data })

onmessage = (event: MessageEvent<WorkerMessage>) => {
  const { type, action, data } = event.data
  const func = decoder[type][action]
  func && func(data)
}
