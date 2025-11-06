import Worker from './render.worker.ts?worker&inline' // 在生产环境中，可能会遇到 MIME type is text/html 的错误。可以通过添加 ?inline 参数避免单独生成 Worker 文件。
import type { CutOption } from './type'

export class RenderWorker {
  worker = new Worker()

  constructor() {}

  init = ({ writable }: { writable: any }) => this.worker.postMessage({ action: 'init', data: { writable } }, [writable])
  push = (frame: { timestamp: number; bitmap: ImageBitmap }) => this.worker.postMessage({ action: 'push', data: frame })
  setCut = async (cutOption: CutOption) => this.worker.postMessage({ action: 'setCut', data: cutOption })
  setPause = (pause: boolean) => this.worker.postMessage({ action: 'setPause', data: pause })
  destroy = () => {
    this.worker.postMessage({ action: 'destroy', data: {} })
    this.worker.terminate()
  }
}
