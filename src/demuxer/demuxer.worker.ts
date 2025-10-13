import { Demuxer } from './Demuxer'

interface WorkerMessage {
  action: 'init' | 'push' | 'destroy'
  data: any
}

const demuxer = new Demuxer()

demuxer.on.header = (data) => postMessage({ action: 'onHeader', data })
demuxer.on.tag = (data) => postMessage({ action: 'onTag', data })

onmessage = (event: MessageEvent<WorkerMessage>) => {
  const { action, data } = event.data
  const func = demuxer[action]
  func && func(data)
}
