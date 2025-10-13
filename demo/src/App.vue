<template>
  <div>
    <div style="font-size: 30px; line-height: 80px; padding-top: 40px">WebCodecsPlayer</div>
    <div style="margin: 8px 0; display: flex; gap: 12px; justify-content: center; flex-wrap: wrap">
      <input style="padding: 6px; width: 240px" id="input" type="text" v-model="url" placeholder="https://xxxx.flv" />
      <div style="display: flex; gap: 12px">
        <button @click="play">Start</button>
        <button @click="stop">Stop</button>
        <button @click="cut">Cut</button>
      </div>
    </div>
    <div class="play-view">
      <div class="canvas-video-frame">
        <div class="title">VideoFrame</div>
        <div id="canvas-video-frame-view" style="background-color: antiquewhite"></div>
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

const url = ref('https://sf1-cdn-tos.huoshanstatic.com/obj/media-fe/xgplayer_doc_video/flv/xgplayer-demo-720p.flv')
const info = ref()

const player = new PrPlayer()

player.on.demuxer.script = (e) => {
  info.value = e.body
}

player.on.video = async (canvas) => {
  canvas.style.width = '100%'
  const canvas_view = document.querySelector('#canvas-video-frame-view')
  if (!canvas_view) return
  canvas_view.replaceChildren(canvas)
}

player.on.cut = async (key, canvas) => {
  canvas.style.width = '100%'
  const video_view = document.querySelector('#canvas-video-cut-view')
  video_view?.replaceChildren(canvas)
}

const play = async () => {
  player.init()
  player.start(url.value)
  player.audio.setMute(false)
}

const cut = () => {
  const { width, height } = info.value
  player.video.createCut('cut-any-key', { sx: width * 0.25, sy: height * 0.4, sw: width * 0.5, sh: height * 0.5 })
  // player.video.createCut('cut-any-key', { sx: 0, sy: 0, sw: width, sh: height })
}

const stop = () => {
  player.stop()
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
#canvas-video-cut-view {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
