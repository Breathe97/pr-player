export class VideoPlayer {
  private isRendering = false
  private pendingFrames: { timestamp: number; bitmap: ImageBitmap }[] = []

  private offscreenCanvas: OffscreenCanvas | undefined

  private ctx: OffscreenCanvasRenderingContext2D | null | undefined

  private baseTime = 0

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
      this.isRendering = false

      this.isRendering = true

      let { timestamp, bitmap } = frame

      const timeUntilNextFrame = this.calculateTimeUntilNextFrame(timestamp)

      if (this.ctx && this.offscreenCanvas) {
        await new Promise((resolve) => setTimeout(() => resolve(true), timeUntilNextFrame))
        this.ctx.drawImage(bitmap, 0, 0, this.offscreenCanvas.width, this.offscreenCanvas.height)
      }

      bitmap.close()
    }

    this.isRendering = false
  }
}
