import type { CutOption } from './type'

export class Render {
  private renderMap = new Map<string, { writable: any; writer: any; pause: boolean; option?: CutOption }>()

  constructor() {}

  push = async (frame: { timestamp: number; bitmap: ImageBitmap }) => {
    const { timestamp } = frame
    const { bitmap } = frame
    if (bitmap.height === 0 || bitmap.width === 0) {
      return bitmap.close()
    }

    const cut_keys = [...this.renderMap.keys()]
    for (const cut_key of cut_keys) {
      const ins = this.renderMap.get(cut_key)
      if (!ins) continue
      const { pause = false, writer, option } = ins

      if (pause === true) continue // 已暂停

      // 原画
      if (cut_key === 'default' || !option) {
        const videoFrame = new VideoFrame(bitmap, { timestamp })
        writer.write(videoFrame)
        videoFrame.close() // 销毁动画帧数据
      }

      // 裁剪
      else {
        const { sx = 0, sy = 0, sw = bitmap.width, sh = bitmap.height } = option
        const newBitmap = await createImageBitmap(bitmap, sx, sy, sw, sh)
        const videoFrame = new VideoFrame(newBitmap, { timestamp })
        newBitmap.close() // 销毁剪切后的原始帧数据
        writer.write(videoFrame)
        videoFrame.close() // 销毁剪切后的动画帧数据
      }
    }
    bitmap.close() // 销毁原始帧数据
  }

  /**
   * 增加剪切
   */
  addCut = (data: { key?: string; writable: any; option?: CutOption }) => {
    const { key, writable, option } = { key: 'default', ...data }
    const writer = writable.getWriter()
    this.renderMap.set(key, { writable, writer, option, pause: false })
  }

  /**
   * 删除剪切
   */

  delCut = (key: string) => {
    this.renderMap.delete(key)
  }

  /**
   * 设置剪切
   */
  setCut = (data: { key?: string; cutOption: CutOption }) => {
    const { key, cutOption } = { key: 'default', ...data }
    const cut_ins = this.renderMap.get(key)
    if (cut_ins) {
      this.renderMap.set(key, { ...cut_ins, option: cutOption })
    }
  }

  /**
   * 设置暂停
   */
  setPause = (data: { key?: string; pause: boolean }) => {
    const { key, pause } = { key: 'default', ...data }
    const cut_ins = this.renderMap.get(key)
    if (cut_ins) {
      this.renderMap.set(key, { ...cut_ins, pause })
    }
  }

  destroy = () => {
    this.renderMap = new Map()
  }
}
