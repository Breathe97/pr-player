import { Render } from './Render'

interface WorkerMessage {
  action: 'init' | 'setSize' | 'setShader' | 'setBaseTime' | 'push' | 'setCut' | 'setPause' | 'destroy'
  data: unknown
}

const render = new Render()

onmessage = (event: MessageEvent<WorkerMessage>) => {
  const { action, data } = event.data
  const func = render[action]
  // @ts-ignore
  func && func(data)
}
