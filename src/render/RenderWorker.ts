import Worker from './render.worker.ts?worker&inline' // 在生产环境中，可能会遇到 MIME type is text/html 的错误。可以通过添加 ?inline 参数避免单独生成 Worker 文件。
import type { CutOption } from './type'

export class RenderWorker {
  worker = new Worker()

  constructor() {}

  push = (frame: { timestamp: number; bitmap: ImageBitmap }) => this.worker.postMessage({ action: 'push', data: frame }, [frame.bitmap])

  addCut = (data: { key?: string; writable?: any; offscreen?: OffscreenCanvas; option?: CutOption }) => {
    const transfer = []
    data.writable && transfer.push(data.writable)
    data.offscreen && transfer.push(data.offscreen)
    this.worker.postMessage({ action: 'addCut', data }, transfer)
  }

  delCut = (key: string) => this.worker.postMessage({ action: 'delCut', data: key })

  setCut = (data: { key?: string; cutOption: CutOption }) => this.worker.postMessage({ action: 'setCut', data })

  setPause = (data: { key?: string; pause: boolean }) => this.worker.postMessage({ action: 'setPause', data: data })

  destroy = () => {
    this.worker.postMessage({ action: 'destroy', data: {} })
    this.worker.terminate()
  }
}
