import type { CutOption } from './type'

export class Render {
  private renderMap = new Map<string, { writer?: any; offscreen?: OffscreenCanvas; pause: boolean; option?: CutOption }>()

  constructor() {}

  push = async (frame: { timestamp: number; bitmap: ImageBitmap }) => {
    const { timestamp } = frame
    const { bitmap } = frame
    if (bitmap.height === 0 || bitmap.width === 0) return bitmap.close() // 异常数据跳过
    try {
      const cut_keys = [...this.renderMap.keys()]
      for (const cut_key of cut_keys) {
        const ins = this.renderMap.get(cut_key)
        if (!ins) continue
        const { pause = false, writer, offscreen, option } = ins

        if (pause === true) continue // 已暂停

        const rendering = (bitmap: ImageBitmap) => {
          if (writer) {
            const videoFrame = new VideoFrame(bitmap, { timestamp })
            try {
              videoFrame && writer.write(videoFrame)
            } catch (error) {}
            videoFrame.close() // 销毁动画帧数据
          }
          //
          else if (offscreen) {
            offscreen.width = bitmap.width
            offscreen.height = bitmap.height
            offscreen?.getContext('2d')?.drawImage(bitmap, 0, 0)
          }
        }

        // 原画
        if (cut_key === 'default') {
          rendering(bitmap)
        }
        // 裁剪
        else if (option) {
          const { sx = 0, sy = 0, sw = bitmap.width, sh = bitmap.height } = option
          const newBitmap = await createImageBitmap(bitmap, sx, sy, sw, sh)
          rendering(newBitmap)
        }
      }
    } catch (error) {}
    bitmap.close() // 销毁原始帧数据
  }

  /**
   * 增加剪切
   */
  addCut = (data: { key?: string; writable: any; offscreen?: OffscreenCanvas; option?: CutOption }) => {
    const { key, writable, offscreen, option } = { key: 'default', ...data }
    if (writable) {
      const writer = writable.getWriter()
      this.renderMap.set(key, { writer, option, pause: false })
    } else {
      this.renderMap.set(key, { offscreen, option, pause: false })
    }
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
