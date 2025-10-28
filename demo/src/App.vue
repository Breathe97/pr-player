<template>
  <div>
    <div style="font-size: 30px; line-height: 80px; padding-top: 40px">WebCodecsPlayer</div>
    <div style="margin: 8px 0; display: flex; gap: 12px; justify-content: center; flex-wrap: wrap">
      <el-input style="width: 320px" v-model="url" placeholder="Please input" class="input-with-select">
        <template #prepend>
          <el-select v-model="url_type" placeholder="Select" style="width: 72px" @change="selectUrl">
            <el-option v-for="item in url_options" :label="item.label" :value="item.value" />
          </el-select>
        </template>
      </el-input>
      <div style="display: flex; gap: 12px">
        <button @click="play">Start</button>
        <button @click="setPause" style="width: 120px">Pause: {{ pause }}</button>
        <button @click="cut">Cut</button>
        <button @click="setCutPause" style="width: 160px">Cut Pause: {{ cut_pause }}</button>
        <button @click="stop">Stop</button>
      </div>
    </div>
    <div class="play-view">
      <div class="canvas-video-frame">
        <div class="title">VideoFrame</div>
        <div id="canvas-video-frame-view" style="background-color: antiquewhite"></div>
      </div>
      <div class="canvas-video-frame">
        <div class="title">MediaStream</div>
        <div id="canvas-video-stream-view" style="background-color: aquamarine"></div>
      </div>
      <div class="canvas-video-cut">
        <div class="title">Cut</div>
        <div id="canvas-video-cut-view" style="background-color: dimgray"></div>
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { ref, nextTick } from 'vue'
// import { PrPlayer } from 'pr-player'
// import { PrPlayer } from '../../dist/index'
import { PrPlayer } from '../../src/index'

const url_options = [
  { label: 'flv', value: 'https://sf1-cdn-tos.huoshanstatic.com/obj/media-fe/xgplayer_doc_video/flv/xgplayer-demo-720p.flv' },
  { label: 'flv-live', value: 'https://stream.quickvo.live/stream_d88ab189-6316-41b2-9b44-fdd41d534967/1761636432807.flv?auth_key=1761722832-0-0-5525e8e71a792f4f367a616ff5b8b2b7' },
  { label: 'hls', value: 'https://sf1-cdn-tos.huoshanstatic.com/obj/media-fe/xgplayer_doc_video/hls/xgplayer-demo.m3u8' },
  { label: 'hls-live', value: 'https://stream.quickvo.live/stream_d88ab189-6316-41b2-9b44-fdd41d534967/1761636432807.m3u8?auth_key=1761722832-0-0-9e041f61a46bfb30ea622eb8d41ddcfa' }
]

const url_type = ref<'flv' | 'hls'>('flv')

const url = ref('')

const selectUrl = (_url: string) => {
  console.log('\x1b[38;2;0;151;255m%c%s\x1b[0m', 'color:#0097ff;', `------->Breathe: _url`, _url)
  url.value = _url
}

const init = () => {
  url.value = url_options.find((item) => item.label === url_type.value)?.value || ''
}
init()

const info = ref()

const player = new PrPlayer({ debug: true })

player.on.demuxer.info = (e) => {
  info.value = e
}

player.on.demuxer.chunk = (e) => {
  console.log('\x1b[38;2;0;151;255m%c%s\x1b[0m', 'color:#0097ff;', `------->Breathe: chunk`, e)
}

player.on.demuxer.sei = (e) => {
  console.log('\x1b[38;2;0;151;255m%c%s\x1b[0m', 'color:#0097ff;', `------->Breathe: sei`, e)
}

const pause = ref(false)
const setPause = () => {
  pause.value = !pause.value
  player.setPause(pause.value)
}

const cut_pause = ref(false)
const setCutPause = () => {
  cut_pause.value = !cut_pause.value
  player.cut.setPause('cut-any-key', cut_pause.value)
}

const stop = () => {
  player.stop()
}

const play = async () => {
  pause.value = false
  await player.start(url.value)
  player.setMute(false)

  {
    const canvas = player.getCanvas()
    if (canvas) {
      canvas.style.height = '100%'
      const canvas_view = document.querySelector('#canvas-video-frame-view')
      if (canvas_view) {
        canvas_view.replaceChildren(canvas)
      }
    }
  }

  {
    const stream = player.getStream()
    if (stream) {
      const dom = document.querySelector('#canvas-video-stream-view')
      const view = document.createElement('video')
      view.style.width = '100%'
      view.style.height = '100%'
      view.srcObject = stream
      view.play()
      dom?.replaceChildren(view)
    }
  }
}

const cut = () => {
  cut_pause.value = false
  const { width, height } = info.value
  player.cut.create('cut-any-key', { sx: width * 0.25, sy: height * 0.4, sw: width * 0.5, sh: height * 0.5 })

  {
    const stream = player.cut.getStream('cut-any-key')
    if (stream) {
      const dom = document.querySelector('#canvas-video-cut-view')
      const view = document.createElement('video')
      view.style.width = '100%'
      view.style.height = '100%'
      view.srcObject = stream
      view.play()
      dom?.replaceChildren(view)
    }
  }
}
</script>
<style scoped>
.play-view {
  position: relative;
  padding: 12px;
  display: flex;
  flex-wrap: wrap;
  align-items: stretch;
  justify-content: center;
  gap: 12px;
}

.canvas-video-frame,
.canvas-video-cut {
  flex: 1;
  min-width: 320px;
  max-width: 600px;
  aspect-ratio: 16/9;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.title {
  font-size: 20px;
  line-height: 40px;
}

#canvas-video-frame-view,
#canvas-video-stream-view,
#canvas-video-cut-view {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
</style>
