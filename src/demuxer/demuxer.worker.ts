import { Demuxer } from './Demuxer'

interface WorkerMessage {
  action: 'init' | 'push' | 'destroy'
  data: never
}

const demuxer = new Demuxer()

demuxer.on.info = (data) => postMessage({ action: 'on.info', data })
demuxer.on.config = (data) => postMessage({ action: 'on.config', data })
demuxer.on.chunk = (data) => postMessage({ action: 'on.chunk', data })
demuxer.on.debug = (data) => postMessage({ action: 'on.debug', data })

onmessage = (event: MessageEvent<WorkerMessage>) => {
  const { action, data } = event.data
  const func = demuxer[action]
  func && func(data)
}
