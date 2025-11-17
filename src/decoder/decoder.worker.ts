import { Decoder } from './Decoder'

interface WorkerMessage {
  type: 'audio' | 'video'
  action: 'push' | 'flush' | 'destroy'
  data: any
}

const decoder = new Decoder()

decoder.on.audio.decode = (data) => postMessage({ type: 'audio', action: 'onDecode', data })
decoder.on.audio.error = (data) => postMessage({ type: 'audio', action: 'onError', data })

decoder.on.video.decode = (data) => postMessage({ type: 'video', action: 'onDecode', data })
decoder.on.video.error = (data) => postMessage({ type: 'video', action: 'onError', data })

onmessage = (event: MessageEvent<WorkerMessage>) => {
  const { type, action, data } = event.data
  if (type) {
    const func = decoder[type][action]
    func && func(data)
  } else {
    // @ts-ignore
    const func = decoder[action]
    func && func(data)
  }
}
