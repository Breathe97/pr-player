import { Render } from './Render'

interface WorkerMessage {
  action: 'init' | 'push' | 'setCut' | 'setPause' | 'destroy'
  data: any
}

const render = new Render()

onmessage = (event: MessageEvent<WorkerMessage>) => {
  const { action, data } = event.data
  const func = render[action]
  func && func(data)
}
