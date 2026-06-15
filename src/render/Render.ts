import type { CutOption } from './type'

export class Render {
  private renderMap = new Map<string, { writer?: any; offscreen?: OffscreenCanvas; pause: boolean; option?: CutOption }>()

  constructor() {}

  push = async (data: { timestamp: number; frame: VideoFrame }) => {
    const source = data.frame
    const timestamp = source.timestamp

    try {
      const entries = [...this.renderMap.entries()].filter(([, ins]) => ins && !ins.pause)
      // 仅主路 generator 且无 cut 时零拷贝直写
      const isSingleDefaultWriter =
        entries.length === 1 && entries[0][0] === 'default' && !!entries[0][1].writer

      if (isSingleDefaultWriter) {
        entries[0][1].writer!.write(source).catch(() => {})
        source.close()
        return
      }

      for (const [cut_key, ins] of entries) {
        const { writer, offscreen, option } = ins

        if (writer) {
          let vf: VideoFrame
          if (cut_key === 'default' || !option) {
            vf = new VideoFrame(source, { timestamp })
          } else {
            const { sx = 0, sy = 0, sw = source.displayWidth, sh = source.displayHeight } = option
            vf = new VideoFrame(source, {
              visibleRect: { x: sx, y: sy, width: sw, height: sh },
              displayWidth: sw,
              displayHeight: sh,
              timestamp
            })
          }
          writer.write(vf).catch(() => {})
          vf.close()
        } else if (offscreen) {
          if (cut_key === 'default' || !option) {
            offscreen.width = source.displayWidth
            offscreen.height = source.displayHeight
            offscreen.getContext('2d')?.drawImage(source, 0, 0)
          } else {
            const { sx = 0, sy = 0, sw = source.displayWidth, sh = source.displayHeight } = option
            offscreen.width = sw
            offscreen.height = sh
            offscreen.getContext('2d')?.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh)
          }
        }
      }
    } catch {}

    source.close()
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
