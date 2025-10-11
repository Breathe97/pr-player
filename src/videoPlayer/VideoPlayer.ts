import { CutOption } from './type'

export class VideoPlayer {
  private isRendering = false
  private pendingFrames: { timestamp: number; bitmap: ImageBitmap }[] = []

  private offscreenCanvas: OffscreenCanvas | undefined

  private ctx: OffscreenCanvasRenderingContext2D | null | undefined

  private baseTime = 0

  private cutOption: CutOption | undefined

  constructor() {}

  setCut = async (cutOption: CutOption) => {
    this.cutOption = { ...this.cutOption, ...cutOption }
  }

  init = ({ offscreenCanvas, baseTime = 0 }: { offscreenCanvas: OffscreenCanvas; baseTime?: number }) => {
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
    this.cutOption = undefined
  }

  push = (frame: { timestamp: number; bitmap: ImageBitmap }) => {
    this.pendingFrames.push(frame)
    if (this.isRendering === false) {
      setTimeout(this.renderFrame, 0)
    }
  }

  private calculateTimeUntilNextFrame = (timestamp: number) => {
    if (this.baseTime == 0) this.baseTime = performance.now()
    let mediaTime = performance.now() - this.baseTime
    return Math.max(0, timestamp / 1000 - mediaTime)
  }

  private renderFrame = async () => {
    const frame = this.pendingFrames.shift()

    this.isRendering = Boolean(frame)

    if (!frame) {
      this.isRendering = false
      return
    }

    this.isRendering = true

    let { timestamp, bitmap } = frame

    if (this.cutOption) {
      const { sx = 0, sy = 0, sw = bitmap.width, sh = bitmap.height } = this.cutOption
      const cutBitmap = await createImageBitmap(bitmap, sx, sy, sw, sh)
      bitmap.close()
      bitmap = cutBitmap
    }

    const timeUntilNextFrame = this.calculateTimeUntilNextFrame(timestamp)
    await new Promise((r) => setTimeout(r, timeUntilNextFrame))

    if (this.ctx && this.offscreenCanvas) {
      this.ctx.drawImage(bitmap, 0, 0, this.offscreenCanvas.width, this.offscreenCanvas.height)
    }

    bitmap.close()

    setTimeout(this.renderFrame, 0)
  }
}
