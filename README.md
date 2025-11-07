# 对 flv 格式的地址进行解析 并输出 MediaStream，提供 demuxer 层(info、chunk、sei)回调、 decoder 层(audio、video)回调 ，提供 cut 等相关能力，以支持根据业务层 SEI 对视频进行剪切渲染。

## 立即开始

### 安装

```bash
npm i pr-player
```

### 引入

```js
import { PrPlayer } from 'pr-player'

// 除此之外 如果你需要自定义扩展 为你提供了独立的 Demuxer、Decoder、Render
import { DemuxerWorker } from '../../src/index'
import { DecoderWorker } from '../../src/index'
import { RenderWorker } from '../../src/index'
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
  player.on.demuxer.sei = (sei) => {
    console.log('\x1b[38;2;0;151;255m%c%s\x1b[0m', 'color:#0097ff;', `------->Breathe: sei`, sei)
  }
}

// 如果你只需要解码器相关的能力 可以拿到解码后的所有回调
{
  player.on.decoder.audio = (audio) => {
    console.log('\x1b[38;2;0;151;255m%c%s\x1b[0m', 'color:#0097ff;', `------->Breathe: audio`, audio)
  }
  player.on.decoder.video = (video) => {
    console.log('\x1b[38;2;0;151;255m%c%s\x1b[0m', 'color:#0097ff;', `------->Breathe: video`, video)
  }
}

await player.start('https://sf1-cdn-tos.huoshanstatic.com/obj/media-fe/xgplayer_doc_video/flv/xgplayer-demo-720p.flv')
player.setMute(false) // 默认都是静音 所以主动开启
const stream = player.getStream()
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
player.cut.create('cut-any-key', { sx: width * 0.25, sy: height * 0.4, sw: width * 0.5, sh: height * 0.5 })
const stream = player.cut.getStream('cut-any-key')
```

### 暂停剪切

```js
player.cut.setPause('cut-any-key', true)
```

### 移除剪切

```js
player.cut.remove('cut-any-key')
```

## 代码仓库

[github](https://github.com/breathe97/pr-player)

## 贡献

breathe
