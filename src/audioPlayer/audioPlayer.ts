import { PrAudioStream } from 'pr-audio-stream'

const convertToAudioBuffer = async (audioContext: AudioContext, audioData: AudioData): Promise<AudioBuffer> => {
  try {
    const { format, numberOfChannels, numberOfFrames, sampleRate } = audioData
    const audioBuffer = audioContext.createBuffer(numberOfChannels, numberOfFrames, sampleRate)

    for (let channel = 0; channel < numberOfChannels; channel++) {
      const planeSize = audioData.allocationSize({ planeIndex: channel })
      const data = new Uint8Array(planeSize)
      audioData.copyTo(data, { planeIndex: channel })

      const view = new DataView(data.buffer)
      const channelData = audioBuffer.getChannelData(channel)

      for (let i = 0; i < numberOfFrames; i++) {
        let sample: number
        switch (format) {
          case 's16': // 16-bit signed PCM (范围: -32768 ~ 32767)
          case 's16-planar': // 16-bit signed PCM (范围: -32768 ~ 32767)
            sample = view.getInt16(i * 2, true) / 32768.0
            break
          case 'f32': // 32-bit float (范围: -1.0 ~ 1.0)
          case 'f32-planar': // 32-bit float (范围: -1.0 ~ 1.0)
            sample = view.getFloat32(i * 4, true)
            break
          case 'u8': // 8-bit unsigned (范围: 0 ~ 255)
          case 'u8-planar': // 8-bit unsigned (范围: 0 ~ 255)
            sample = (view.getUint8(i) - 128) / 128.0
            break
          default:
            throw new Error(`Unsupported audio format: ${format}`)
        }

        // 确保 sample 在 [-1, 1] 范围内，避免溢出
        channelData[i] = Math.max(-1, Math.min(1, sample))
      }
    }

    return audioBuffer
  } catch (error) {
    console.error('Failed to convert AudioData to AudioBuffer:', error)
    throw error
  }
}

export class AudioPlayer {
  prAudioStream: PrAudioStream | undefined
  audioContext: AudioContext | undefined
  destination: MediaStreamAudioDestinationNode | undefined
  stream = new MediaStream()
  nextStartTime = 0
  pendingSources: AudioBufferSourceNode[] = []

  constructor() {}

  init = (audioContext?: AudioContext) => {
    if (!audioContext) {
      // @ts-ignore
      audioContext = new (window.AudioContext || window.webkitAudioContext)()
    }

    this.audioContext = audioContext

    this.destination = this.audioContext.createMediaStreamDestination()

    this.stream = new MediaStream()
    this.stream.addTrack(this.destination.stream.getAudioTracks()[0])

    this.prAudioStream = new PrAudioStream(this.stream, this.audioContext)

    this.nextStartTime = 0
    this.pendingSources = []
  }

  async push(audioData: AudioData) {
    try {
      if (!this.audioContext) return
      if (!this.destination) return

      // 1. 转换 AudioData 为 AudioBuffer
      const audioBuffer = await convertToAudioBuffer(this.audioContext, audioData)

      if (!audioBuffer) return

      // 2. 创建播放源
      const source = this.audioContext.createBufferSource()
      source.buffer = audioBuffer
      source.connect(this.destination)

      // 3. 计算精确播放时间
      const startTime = Math.max(this.nextStartTime, this.audioContext.currentTime)
      this.nextStartTime = startTime + audioBuffer.duration

      // 4. 调度播放
      source.start(startTime)
      this.pendingSources.push(source)

      // 5. 自动清理
      source.onended = () => {
        this.pendingSources = this.pendingSources.filter((s) => s !== source)
      }

      // 6. 处理首次播放
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume()
      }
    } finally {
      audioData.close()
    }
  }

  getStream = () => this.prAudioStream?.getStream()

  destroy() {
    this.audioContext?.close()
    this.audioContext = undefined
    this.destination = undefined
    this.nextStartTime = 0
    this.prAudioStream?.stop()
    this.pendingSources.forEach((source) => source.stop())
    this.pendingSources = []
  }
}
