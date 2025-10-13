import Worker from './demuxer.worker.ts?worker&inline' // 在生产环境中，可能会遇到 MIME type is text/html 的错误。可以通过添加 ?inline 参数避免单独生成 Worker 文件。
import { On } from './type'

export class DemuxerWorker {
  worker = new Worker()

  public on: On = {}

  constructor() {
    this.worker.onmessage = (e) => {
      const { action, data } = e.data
      if (action === 'onHeader') {
        this.on.header && this.on.header(data)
      }
      if (action === 'onTag') {
        this.on.tag && this.on.tag(data)
      }
    }
  }

  init = () => this.worker.postMessage({ action: 'init' })
  push = (payload: Uint8Array) => this.worker.postMessage({ action: 'push', data: payload })
  destroy = () => {
    this.worker.postMessage({ action: 'destroy', data: {} })
    this.worker.terminate()
  }
}
