import Worker from './index.worker.ts?worker&inline' // 在生产环境中，可能会遇到 MIME type is text/html 的错误。可以通过添加 ?inline 参数避免单独生成 Worker 文件。
import { CutOption } from './type'

export class VideoPlayerWorker {
  worker = new Worker()

  constructor() {}

  setCut = async (cutOption: CutOption) => this.worker.postMessage({ action: 'setCut', data: cutOption })
  init = ({ offscreenCanvas, baseTime = 0 }: { offscreenCanvas: OffscreenCanvas; baseTime?: number }) => this.worker.postMessage({ action: 'init', data: { offscreenCanvas, baseTime } }, [offscreenCanvas])
  destroy = () => this.worker.postMessage({ action: 'destroy', data: {} })
  push = (frame: { timestamp: number; bitmap: ImageBitmap }) => this.worker.postMessage({ action: 'push', data: frame })
}
