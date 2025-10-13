import Worker from './decoder.worker.ts?worker&inline' // 在生产环境中，可能会遇到 MIME type is text/html 的错误。可以通过添加 ?inline 参数避免单独生成 Worker 文件。
import { On } from './type'

export class DecoderWorker {
  worker = new Worker()

  public on: On = { audio: {}, video: {} }

  constructor() {
    this.worker.onmessage = (e) => {
      const { type, action, data } = e.data

      switch (type) {
        case 'audio':
          {
            if (action === 'onDecode') {
              this.on.audio.decode && this.on.audio.decode(data)
            }
            if (action === 'onError') {
              this.on.audio.error && this.on.audio.error(data)
            }
          }
          break
        case 'video':
          {
            if (action === 'onDecode') {
              this.on.video.decode && this.on.video.decode(data)
            }
            if (action === 'onError') {
              this.on.video.error && this.on.video.error(data)
            }
          }
          break
      }
    }
  }

  audio = {
    init: (config: AudioDecoderConfig) => this.worker.postMessage({ type: 'audio', action: 'init', data: config }),
    decode: (init: EncodedAudioChunkInit) => this.worker.postMessage({ type: 'audio', action: 'decode', data: init }),
    flush: () => this.worker.postMessage({ type: 'audio', action: 'flush' }),
    destroy: () => {
      this.worker.postMessage({ type: 'audio', action: 'destroy' })
    }
  }

  video = {
    init: (config: VideoDecoderConfig) => this.worker.postMessage({ type: 'video', action: 'init', data: config }),
    decode: (init: EncodedVideoChunkInit) => this.worker.postMessage({ type: 'video', action: 'decode', data: init }),
    flush: () => this.worker.postMessage({ type: 'video', action: 'flush' }),
    destroy: () => {
      this.worker.postMessage({ type: 'video', action: 'destroy', data: {} })
    }
  }

  destroy = () => {
    this.worker.postMessage({ type: 'audio', action: 'destroy' })
    this.worker.postMessage({ type: 'video', action: 'destroy', data: {} })
    this.worker.terminate()
  }
}
