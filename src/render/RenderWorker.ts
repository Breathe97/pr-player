import Worker from './render.worker.ts?worker&inline' // 在生产环境中，可能会遇到 MIME type is text/html 的错误。可以通过添加 ?inline 参数避免单独生成 Worker 文件。
import { CutOption, Shader } from './type'

export class RenderWorker {
  worker = new Worker()

  constructor() {}

  init = ({ offscreenCanvas, baseTime = 0, writable }: { offscreenCanvas: OffscreenCanvas; baseTime?: number; writable: any }) => this.worker.postMessage({ action: 'init', data: { offscreenCanvas, baseTime, writable } }, [offscreenCanvas, writable])
  setShader = (shader: Shader[]) => this.worker.postMessage({ action: 'setShader', data: shader })
  setSize = ({ width, height }: { width: number; height: number }) => this.worker.postMessage({ action: 'setSize', data: { width, height } })
  push = (frame: { timestamp: number; bitmap: ImageBitmap }) => this.worker.postMessage({ action: 'push', data: frame })
  setCut = async (cutOption: CutOption) => this.worker.postMessage({ action: 'setCut', data: cutOption })
  setPause = (pause: boolean) => this.worker.postMessage({ action: 'setPause', data: pause })
  destroy = () => {
    this.worker.postMessage({ action: 'destroy', data: {} })
    this.worker.terminate()
  }
}
