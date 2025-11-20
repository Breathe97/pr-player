import type { Pattern } from '../type'
import type { On } from './Demuxer'
import Worker from './demuxer.worker.ts?worker&inline' // 在生产环境中，可能会遇到 MIME type is text/html 的错误。可以通过添加 ?inline 参数避免单独生成 Worker 文件。

export class DemuxerWorker {
  worker = new Worker()

  public on: On = {}

  constructor() {
    this.worker.onmessage = (e) => {
      const { action, data } = e.data

      switch (action) {
        case 'on.info':
          this.on.info && this.on.info(data)
          break
        case 'on.config':
          this.on.config && this.on.config(data)
          break
        case 'on.chunk':
          this.on.chunk && this.on.chunk(data)
          break
        case 'on.debug':
          this.on.debug && this.on.debug(data)
          break
      }
    }
  }

  init = (pattern: Pattern) => this.worker.postMessage({ action: 'init', data: pattern })
  push = (payload: Uint8Array) => this.worker.postMessage({ action: 'push', data: payload })
  destroy = () => {
    this.worker.postMessage({ action: 'destroy', data: {} })
    this.worker.terminate()
  }
}
