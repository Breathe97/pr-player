import { VideoPlayer } from './VideoPlayer'

interface WorkerMessage {
  action: 'init' | 'push' | 'destroy'
  data: any
}

const videoPlayer = new VideoPlayer()

onmessage = (event: MessageEvent<WorkerMessage>) => {
  const { action, data } = event.data
  const func = videoPlayer[action]
  func && func(data)
}
