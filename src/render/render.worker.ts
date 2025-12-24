import { Render } from './Render'

interface WorkerMessage {
  action: 'push' | 'addCut' | 'delCut' | 'setCut' | 'setPause' | 'destroy'
  data: never
}

const render = new Render()

onmessage = (event: MessageEvent<WorkerMessage>) => {
  const { action, data } = event.data
  const func = render[action]
  func && func(data)
}
