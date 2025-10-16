# 对 flv 格式的地址进行解析 并输出 canvas、stream，提供 SEI 回调，以及 cut 等相关能力，以支持根据业务层 SEI 对视频进行剪切渲染。

## 立即开始

### 安装

```bash
npm i pr-player
```

### 引入

```js
import { PrPlayer } from 'pr-player'

// 除此之外 如果你需要自定义扩展 为你提供了独立的 Demuxer、Decoder、Render，并且提供对应的worker
import { Demuxer, DemuxerWorker } from '../../src/index'
import { Decoder, DecoderWorker } from '../../src/index'
import { Render, RenderWorker } from '../../src/index'
```

## 快速使用

```js
const player = new PrPlayer()
const play = async () => {
  pause.value = false
  await player.start('https://sf1-cdn-tos.huoshanstatic.com/obj/media-fe/xgplayer_doc_video/flv/xgplayer-demo-720p.flv')
  player.setMute(false)

  // 渲染方式一 tip: 默认只开启 'stream' 如果需要同时使用 'canvas' 、'stream' 则需要手动设置(Player.setShader)
  {
    const canvas = player.getCanvas()
  }

  // 渲染方式二
  {
    const stream = player.getStream()
  }
}
```

### 暂停渲染

```js
player.setPause(true)
```

### 设置渲染模式

- 默认只开启 'stream' 如果需要同时使用 'canvas' 、'stream' 则需要手动设置

```js
player.setShader(['canvas', 'stream'])
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

const canvas = player.cut.getCanvas('cut-any-key')

// 渲染方式二
const stream = player.cut.getStream('cut-any-key')
```

### 暂停剪切

```js
player.cut.setPause('cut-any-key', true)
```

### 设置渲染模式

- 默认只开启 'stream' 如果需要同时使用 'canvas' 、'stream' 则需要手动设置

```js
player.cut.setShader('cut-any-key', ['canvas', 'stream'])
```

### 移除剪切

```js
player.cut.remove('cut-any-key')
```

## 代码仓库

[github](https://github.com/breathe97/pr-player)

## 贡献

breathe
