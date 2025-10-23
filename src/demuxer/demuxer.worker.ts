import { Demuxer } from './Demuxer'

interface WorkerMessage {
  action: 'init' | 'setPattern' | 'push' | 'destroy'
  data: any
}

const demuxer = new Demuxer()

demuxer.on.header = (data) => postMessage({ action: 'onHeader', data })
demuxer.on.tag = (data) => postMessage({ action: 'onTag', data })

demuxer.on.ts = {
  debug: (data) => postMessage({ action: 'onDebug', data }),
  pat: (data) => postMessage({ action: 'onTsPat', data }),
  pmt: (data) => postMessage({ action: 'onTsPmt', data }),
  config: (data) => postMessage({ action: 'onTsConfig', data }),
  audio: (data) => postMessage({ action: 'onTsAudio', data }),
  video: (data) => postMessage({ action: 'onTsVideo', data })
}

onmessage = (event: MessageEvent<WorkerMessage>) => {
  const { action, data } = event.data
  const func = demuxer[action]
  func && func(data)
}
