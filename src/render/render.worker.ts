import { Render } from './Render'

interface WorkerMessage {
  action: 'init' | 'push' | 'setCut' | 'setPause' | 'destroy'
  data: any
}

const videoPlayer = new Render()

onmessage = (event: MessageEvent<WorkerMessage>) => {
  const { action, data } = event.data
  const func = videoPlayer[action]
  func && func(data)
}
