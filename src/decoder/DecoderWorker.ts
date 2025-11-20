import type { Pattern } from '../type'
import Worker from './decoder.worker.ts?worker&inline' // 在生产环境中，可能会遇到 MIME type is text/html 的错误。可以通过添加 ?inline 参数避免单独生成 Worker 文件。
import type { On, PendingChunk } from './type'

export class DecoderWorker {
  worker = new Worker()

  public on: On = { audio: {}, video: {} }

  constructor() {
    this.worker.onmessage = (e) => {
      const { action, data } = e.data

      switch (action) {
        case 'on.audio.decode':
          this.on.audio.decode && this.on.audio.decode(data)
          break
        case 'on.audio.error':
          this.on.audio.error && this.on.audio.error(data)
          break
        case 'on.video.decode':
          this.on.video.decode && this.on.video.decode(data)
          break
        case 'on.video.error':
          this.on.video.error && this.on.video.error(data)
          break
        case 'on.nalus':
          this.on.nalus && this.on.nalus(data)
          break
        case 'on.debug':
          this.on.debug && this.on.debug(data)
          break
      }
    }
  }

  init = (pattern: Pattern) => this.worker.postMessage({ action: 'init', data: pattern })
  initAudio = (config: AudioDecoderConfig) => this.worker.postMessage({ action: 'initAudio', data: config })
  initVideo = (config: VideoDecoderConfig) => this.worker.postMessage({ action: 'initVideo', data: config })
  push = (chunk: PendingChunk) => this.worker.postMessage({ action: 'push', data: chunk })
  setFrameTrack = (frameTrack: boolean) => this.worker.postMessage({ action: 'setFrameTrack', data: frameTrack })
  destroy = () => {
    this.worker.postMessage({ action: 'destroy' })
    this.worker.terminate()
  }
}
