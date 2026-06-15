# 对 flv、hls、dash、mp4 格式的地址进行解析 并输出 MediaStream，提供 demuxer 层(info、chunk)回调、 decoder 层(audio、video、sei)回调 ，提供 cut 等相关能力，以支持根据业务层 SEI 对视频进行剪切渲染。

## 立即开始

### 安装

```bash
npm i pr-player
```

### 引入

```js
import { PrPlayer } from 'pr-player'

// 除此之外 如果你需要自定义扩展 为你提供了独立的 Demuxer、Decoder、Render
import { DemuxerWorker, DecoderWorker, RenderWorker } from 'pr-player'
```

## 快速使用

```js
const player = new PrPlayer()
const player = new PrPlayer({ debug: true })

// 如果你只需要复解器相关的能力 可以拿到复解后的所有回调
{
  player.on.demuxer.info = (info) => {
    console.log('\x1b[38;2;0;151;255m%c%s\x1b[0m', 'color:#0097ff;', `------->Breathe: info`, info)
  }
  player.on.demuxer.chunk = (chunk) => {
    console.log('\x1b[38;2;0;151;255m%c%s\x1b[0m', 'color:#0097ff;', `------->Breathe: chunk`, chunk)
  }
}

// 如果你只需要解码器相关的能力 可以拿到解码后的所有回调
{
  player.on.decoder.audio = (audio) => {
    console.log('\x1b[38;2;0;151;255m%c%s\x1b[0m', 'color:#0097ff;', `------->Breathe: audio`, audio)
  }
  player.on.decoder.video = (video) => {
    console.log('\x1b[38;2;0;151;255m%c%s\x1b[0m', 'color:#0097ff;', `------->Breathe: video`, video)
    // video.frame 为 VideoFrame，使用后需要 video.frame.close()
  }
  player.on.decoder.sei = (sei) => {
    console.log('\x1b[38;2;0;151;255m%c%s\x1b[0m', 'color:#0097ff;', `------->Breathe: sei`, sei)
  }
}

await player.start('https://sf1-cdn-tos.huoshanstatic.com/obj/media-fe/xgplayer_doc_video/flv/xgplayer-demo-720p.flv')
player.setMute(false) // 默认都是静音 所以主动开启
const stream = player.getStream()

// 绑定到 video 标签
const view = document.createElement('video')
view.srcObject = stream
view.play()
```

### 暂停渲染

```js
player.setPause(true)
```

### 停止

```js
player.stop()
```

## 以下是剪切相关 API

- 例如我需要创建一个名为 cut-any-key 的自定义剪切，将提供以下 api 支持:

### 创建剪切

```js
// sx、sy、sw、sh 为原视频坐标系下的裁剪区域，通常配合 on.demuxer.info 中的 width、height 使用
const { width, height } = info
player.cut.create('cut-any-key', { sx: width * 0.25, sy: height * 0.4, sw: width * 0.5, sh: height * 0.5 })
const stream = player.cut.getStream('cut-any-key')
```

### 修改剪切区域

```js
player.cut.setCut('cut-any-key', { sx: 100, sy: 100, sw: 640, sh: 360 })
```

### 暂停剪切

```js
player.cut.setPause('cut-any-key', true)
```

### 移除剪切

```js
player.cut.remove('cut-any-key')
```

## 结合 SEI 进行剪切

- 典型流程：解析 SEI 拿到业务坐标 → 创建或更新 cut → 输出独立 MediaStream

```js
let videoInfo

player.on.demuxer.info = (info) => {
  videoInfo = info
}

player.on.decoder.sei = (sei) => {
  // 根据业务协议解析 sei，得到裁剪区域
  const { sx, sy, sw, sh } = parseSeiRect(sei, videoInfo)

  if (!player.cut.getStream('sei-cut')) {
    player.cut.create('sei-cut', { sx, sy, sw, sh })
  } else {
    player.cut.setCut('sei-cut', { sx, sy, sw, sh })
  }
}

await player.start(url)
const cutStream = player.cut.getStream('sei-cut')
```

## PrPlayer API

### 构造

```js
new PrPlayer({ debug?: boolean })
```

- `debug`：开启后在控制台输出 demuxer、decoder 部分调试信息

### 实例方法

| 方法 | 说明 |
| --- | --- |
| `start(url)` | 开始拉流并解析，第一帧视频到达后 resolve |
| `stop()` | 停止拉流，销毁 worker 与 MediaStream |
| `getStream()` | 获取主路视频 MediaStream |
| `setPause(pause)` | 暂停/恢复主路渲染 |
| `setMute(state?)` | 设置静音，默认静音，播放前通常需 `setMute(false)` |
| `setOutputGain(gain)` | 设置输出音量 |
| `setFrameTrack(frameTrack)` | 开启/关闭追帧，适用于直播场景 |
| `isReady()` | 返回 Promise，MediaStream 激活后 resolve |

### cut 命名空间

| 方法 | 说明 |
| --- | --- |
| `cut.create(key, { sx, sy, sw, sh })` | 创建剪切路，返回 cut 的 MediaStream |
| `cut.getStream(key)` | 获取已创建的 cut MediaStream |
| `cut.setCut(key, cutOption)` | 运行时修改裁剪区域 |
| `cut.setPause(key, pause)` | 暂停/恢复指定 cut 路 |
| `cut.remove(key)` | 移除指定 cut 路 |

### 实例属性

- `player.on`：事件回调，见下方
- `player.audioPlayer`：内部音频播放器，可通过 `player.audioPlayer.getStream()` 获取音频 MediaStream

## 事件回调 player.on

### demuxer

```js
player.on.demuxer.info = (info) => {}    // 流元信息，如 width、height
player.on.demuxer.config = (config) => {} // 音视频 decoder 配置
player.on.demuxer.chunk = (chunk) => {}  // 解复用后的 chunk
```

### decoder

```js
player.on.decoder.audio = ({ audioData, playbackRate }) => {}
player.on.decoder.video = ({ timestamp, frame }) => {} // frame 为 VideoFrame
player.on.decoder.sei = (payload) => {}                // H.264 SEI 载荷
player.on.decoder.analysis = ({ fps, cacheLength, decodingSpeed, decodingSpeedRatio }) => {}
```

### 其他

```js
player.on.debug = (e) => {}
player.on.error = (e) => {}
```

## 支持的地址格式

- `flv`：HTTP-FLV 直播/点播
- `hls`：`.m3u8` 直播/点播（TS 容器 + H.264/AAC）
- `dash`：`.mpd` DASH 点播/直播（fMP4 分片 + H.264/AAC）
- `mp4`：渐进式 MP4 点播（H.264/AAC）

```js
// flv
await player.start('https://example.com/live.flv')

// hls
await player.start('https://example.com/live.m3u8')

// dash
await player.start('https://example.com/manifest.mpd')

// mp4
await player.start('https://example.com/video.mp4')
```

- 直播场景可配合 `setFrameTrack(true)` 自动追帧
- hls / dash / mp4 点播会自动关闭追帧
- `rtmp://` 地址浏览器内不支持，请使用 HTTP-FLV 或 HLS 替代

## 自定义扩展

- 如果你不需要完整的 PrPlayer，可以单独使用 Worker 层自行组装管线：

```js
import { DemuxerWorker, DecoderWorker, RenderWorker } from 'pr-player'

const demuxerWorker = new DemuxerWorker()
const decoderWorker = new DecoderWorker()
const renderWorker = new RenderWorker()
```

## 浏览器要求

- 需支持 WebCodecs（`VideoDecoder` / `AudioDecoder`）
- 视频输出优先使用 `MediaStreamTrackGenerator`，不支持时自动降级为 `canvas.captureStream()`
- 剪切多路输出需浏览器支持 `VideoFrame` 的 `visibleRect` 裁剪

## 代码仓库

[github](https://github.com/breathe97/pr-player)

## 贡献

breathe
