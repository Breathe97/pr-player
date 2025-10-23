import Worker from './demuxer.worker.ts?worker&inline' // 在生产环境中，可能会遇到 MIME type is text/html 的错误。可以通过添加 ?inline 参数避免单独生成 Worker 文件。
import { On, Pattern } from './type'

export class DemuxerWorker {
  worker = new Worker()

  public on: On = {}

  constructor() {
    this.worker.onmessage = (e) => {
      const { action, data } = e.data

      switch (action) {
        case 'onHeader':
          this.on.header && this.on.header(data)
          break
        case 'onTag':
          this.on.tag && this.on.tag(data)
          break
        case 'onDebug':
          this.on.ts?.debug && this.on.ts.debug(data)
          break
        case 'onTsPat':
          this.on.ts?.pat && this.on.ts.pat(data)
          break
        case 'onTsPmt':
          this.on.ts?.pmt && this.on.ts.pmt(data)
          break
        case 'onTsConfig':
          this.on.ts?.config && this.on.ts.config(data)
          break
        case 'onTsAudio':
          this.on.ts?.audio && this.on.ts.audio(data)
          break
        case 'onTsVideo':
          this.on.ts?.video && this.on.ts.video(data)
          break
      }
    }
  }

  init = () => this.worker.postMessage({ action: 'init' })
  setPattern = (pattern: Pattern) => this.worker.postMessage({ action: 'setPattern', data: pattern })
  push = (payload: Uint8Array) => this.worker.postMessage({ action: 'push', data: payload })
  destroy = () => {
    this.worker.postMessage({ action: 'destroy', data: {} })
    this.worker.terminate()
  }
}
