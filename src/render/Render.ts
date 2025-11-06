import type { CutOption } from './type'

export class Render {
  private writable: any
  private writer: any

  private cutOption: CutOption | undefined

  private pause = false

  constructor() {}

  init = ({ writable }: { writable: any }) => {
    this.destroy()
    this.writable = writable
    this.writer = this.writable.getWriter()
  }

  push = async (frame: { timestamp: number; bitmap: ImageBitmap }) => {
    if (this.pause) return
    const { timestamp } = frame
    let { bitmap } = frame

    // 剪切渲染
    if (this.cutOption) {
      const { sx = 0, sy = 0, sw = bitmap.width, sh = bitmap.height } = this.cutOption
      bitmap = await createImageBitmap(bitmap, sx, sy, sw, sh)
      this.cutOption && bitmap.close() // 剪切需要创建新的 ImageBitmap 才需要关闭
    }

    const videoFrame = new VideoFrame(bitmap, { timestamp })
    this.writer.write(videoFrame)
    videoFrame.close()
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
  }

  destroy = () => {
    this.writable = undefined
    this.writer = undefined
    this.cutOption = undefined
  }
}
