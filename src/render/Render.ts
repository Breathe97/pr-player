import { CutOption } from './type'

export class Render {
  private isRendering = false
  private pendingFrames: { timestamp: number; bitmap: ImageBitmap }[] = []

  private offscreenCanvas: OffscreenCanvas | undefined

  private ctx: OffscreenCanvasRenderingContext2D | null | undefined

  private cutOption: CutOption | undefined

  private baseTime = 0

  private pause = true

  constructor() {}

  init = ({ offscreenCanvas, baseTime = performance.timeOrigin }: { offscreenCanvas: OffscreenCanvas; baseTime?: number }) => {
    this.destroy()
    this.offscreenCanvas = offscreenCanvas
    this.ctx = this.offscreenCanvas.getContext('2d')
    this.baseTime = baseTime
  }

  destroy = () => {
    this.isRendering = false
    this.pendingFrames = []
    this.offscreenCanvas = undefined
    this.ctx = undefined
    this.baseTime = 0
  }

  push = (frame: { timestamp: number; bitmap: ImageBitmap }) => {
    this.pendingFrames.push(frame)
    if (this.isRendering === false) {
      setTimeout(this.renderFrame, 0)
    }
  }

  /**
   * 设置剪切
   */
  setCut = (cutOption: CutOption) => {
    this.cutOption = cutOption
  }

  /**
   * 设置暂停
   */
  setPause = (pause: boolean) => {
    this.pause = pause
    if (this.isRendering === false) {
      setTimeout(this.renderFrame, 0)
    }
  }

  private calculateTimeUntilNextFrame = (timestamp: number) => {
    const currentTime = performance.timeOrigin + performance.now()
    const renderTime = this.baseTime + timestamp / 1000
    const waitTime = renderTime - currentTime
    return Math.max(0, waitTime)
  }

  private renderFrame = async () => {
    this.isRendering = true

    while (true) {
      const frame = this.pendingFrames.shift()
      if (!frame) break

      let { timestamp, bitmap } = frame

      // 剪切渲染
      if (this.cutOption) {
        const { sx = 0, sy = 0, sw = bitmap.width, sh = bitmap.height } = this.cutOption
        bitmap = await createImageBitmap(bitmap, sx, sy, sw, sh)
      }

      const timeUntilNextFrame = this.calculateTimeUntilNextFrame(timestamp)
      await new Promise((resolve) => setTimeout(() => resolve(true), timeUntilNextFrame))
      this.drawImage(bitmap)

      this.cutOption && bitmap.close() // 剪切需要创建新的 ImageBitmap 才需要关闭
    }

    this.isRendering = false
  }

  private drawImage = (bitmap: ImageBitmap) => {
    if (!this.ctx || !this.offscreenCanvas || this.pause === true) return
    this.ctx.drawImage(bitmap, 0, 0, this.offscreenCanvas.width, this.offscreenCanvas.height)
  }
}
