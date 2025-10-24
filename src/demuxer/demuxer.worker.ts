import { Demuxer } from './Demuxer'

interface WorkerMessage {
  action: 'init' | 'push' | 'destroy'
  data: any
}

const demuxer = new Demuxer()

demuxer.on.debug = (data) => postMessage({ action: 'onDebug', data })
demuxer.on.config = (data) => postMessage({ action: 'onConfig', data })
demuxer.on.chunk = (data) => postMessage({ action: 'onChunk', data })

onmessage = (event: MessageEvent<WorkerMessage>) => {
  const { action, data } = event.data
  const func = demuxer[action]
  func && func(data)
}
