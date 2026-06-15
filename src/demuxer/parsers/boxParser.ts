export interface BoxInfo {
  offset: number
  size: number
  type: string
  headerSize: number
  contentStart: number
}

export const readBoxType = (view: DataView, offset: number) => {
  return String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3))
}

export const readBoxAt = (view: DataView, offset: number, end: number): BoxInfo | null => {
  if (offset + 8 > end) return null

  let size = view.getUint32(offset, false)
  const type = readBoxType(view, offset + 4)
  let headerSize = 8

  if (size === 1) {
    if (offset + 16 > end) return null
    size = Number(view.getBigUint64(offset + 8, false))
    headerSize = 16
  } else if (size === 0) {
    size = end - offset
  }

  if (size < headerSize || offset + size > end) return null

  return {
    offset,
    size,
    type,
    headerSize,
    contentStart: offset + headerSize
  }
}

export const forEachBox = (view: DataView, start: number, end: number, fn: (box: BoxInfo) => void) => {
  let offset = start
  while (offset < end) {
    const box = readBoxAt(view, offset, end)
    if (!box) break
    fn(box)
    offset += box.size
  }
}

export const findBox = (view: DataView, start: number, end: number, type: string): BoxInfo | null => {
  let found: BoxInfo | null = null
  forEachBox(view, start, end, (box) => {
    if (box.type === type) found = box
    else if (box.type !== 'mdat') {
      const inner = findBox(view, box.contentStart, box.offset + box.size, type)
      if (inner) found = inner
    }
  })
  return found
}

export const collectBoxes = (view: DataView, start: number, end: number, type: string, out: BoxInfo[] = []) => {
  forEachBox(view, start, end, (box) => {
    if (box.type === type) out.push(box)
    else if (box.type !== 'mdat') {
      collectBoxes(view, box.contentStart, box.offset + box.size, type, out)
    }
  })
  return out
}

export const findBoxInRange = (view: DataView, start: number, end: number, type: string): BoxInfo | null => {
  for (let offset = start; offset + 8 <= end; offset++) {
    if (readBoxType(view, offset + 4) !== type) continue
    const box = readBoxAt(view, offset, end)
    if (box?.type === type) return box
  }
  return null
}

export const findSampleEntryChild = (
  view: DataView,
  entryStart: number,
  entryEnd: number,
  type: string,
  skipBytes = 86
): BoxInfo | null => {
  const child = findBoxInRange(view, entryStart + skipBytes, entryEnd, type)
  if (child) return child
  return findBoxInRange(view, entryStart + 8, entryEnd, type)
}

export const listTopLevelBoxes = (view: DataView, end: number, limit = 30) => {
  const boxes: { type: string; offset: number; size: number }[] = []
  let offset = 0
  while (offset < end && boxes.length < limit) {
    const box = readBoxAt(view, offset, end)
    if (!box) break
    boxes.push({ type: box.type, offset: box.offset, size: box.size })
    offset += box.size
  }
  return boxes
}
