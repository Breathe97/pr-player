import { CutOption, Shader } from './type'

export class Render {
  private isRendering = false
  private pendingFrames: { timestamp: number; bitmap: ImageBitmap }[] = []

  private offscreenCanvas: OffscreenCanvas | undefined

  private writable: any
  private writer: any

  private ctx: OffscreenCanvasRenderingContext2D | null | undefined

  private cutOption: CutOption | undefined

  private baseTime = 0

  private pause = false

  private shader: Shader[] = ['stream']

  constructor() {}

  init = ({ offscreenCanvas, writable }: { offscreenCanvas: OffscreenCanvas; writable: any }) => {
    this.destroy()
    this.offscreenCanvas = offscreenCanvas
    this.writable = writable
    this.writer = this.writable.getWriter()
    this.ctx = this.offscreenCanvas.getContext('2d')
  }

  /**
   * 设置渲染基准时间
   */
  setBaseTime = (baseTime: number) => {
    this.baseTime = baseTime
  }

  /**
   * 设置渲染模式
   */
  setShader = (shader: Shader[]) => {
    this.shader = shader
  }

  /**
   * 设置尺寸
   */
  setSize = ({ width, height }: { width: number; height: number }) => {
    if (!this.offscreenCanvas) return
    this.offscreenCanvas.width = width
    this.offscreenCanvas.height = height
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
      this.drawImage({ timestamp, bitmap })

      this.cutOption && bitmap.close() // 剪切需要创建新的 ImageBitmap 才需要关闭
    }

    this.isRendering = false
  }

  private drawImage = (frame: { timestamp: number; bitmap: ImageBitmap }) => {
    if (this.pause === true) return
    if (this.shader.includes('stream')) {
      const videoFrame = new VideoFrame(frame.bitmap, { timestamp: frame.timestamp })
      this.writer.write(videoFrame)
      videoFrame.close()
    }
    if (this.shader.includes('canvas')) {
      if (this.ctx && this.offscreenCanvas) {
        this.ctx.drawImage(frame.bitmap, 0, 0, this.offscreenCanvas.width, this.offscreenCanvas.height)
      }
    }
  }
}
