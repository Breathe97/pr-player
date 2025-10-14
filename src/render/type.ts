export interface CutOption extends ImageBitmapOptions {
  sx: number
  sy: number
  sw: number
  sh: number
}

export type Shader = 'canvas' | 'stream'
