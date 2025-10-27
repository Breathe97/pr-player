type ResolveInfo = Map<string, { resolve: Function; timer: number }>

export class PrResolves {
  resolvesMap = new Map<string, ResolveInfo>()

  index = 0

  constructor() {}

  /**
   *
   * @param eventKey 唯一key
   * @param checkFun 检测函数
   * @param timeout 超时时间 ms
   * @returns
   */
  add = (eventKey: string, checkFun: Function = () => false, timeout: number = 0) => {
    return new Promise((resolve) => {
      const isAdopt = checkFun()
      if (Boolean(isAdopt)) return resolve(true)
      const had = this.resolvesMap.has(eventKey)
      if (!had) {
        this.resolvesMap.set(eventKey, new Map())
      }

      this.index++
      const resolveKey = `${this.index}`

      timeout = Math.max(0, timeout)

      // 没有超时时间
      if (timeout === 0) {
        this.resolvesMap.get(eventKey)?.set(resolveKey, { resolve, timer: 0 })
        return
      }
      const timer = window.setTimeout(() => {
        this.emit(eventKey)
      }, timeout) // 超时直接返回成功

      this.resolvesMap.get(eventKey)?.set(resolveKey, { resolve, timer })
    })
  }

  emit = async (eventKey: string) => {
    const eventsMap = this.resolvesMap.get(eventKey)
    if (!eventsMap) return
    const resolveKeys = [...eventsMap.keys()]
    for (const resolveKey of resolveKeys) {
      const resolveInfo = eventsMap.get(resolveKey)
      if (resolveInfo) {
        clearTimeout(resolveInfo.timer)
        resolveInfo.resolve()
        eventsMap.delete(resolveKey)
      }
    }
  }
}
