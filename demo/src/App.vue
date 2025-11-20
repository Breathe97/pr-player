<template>
  <div class="pr-player">
    <div style="font-size: 30px; line-height: 80px">Pr-Player</div>
    <div style="margin: 8px 0; display: flex; gap: 12px; justify-content: center; flex-wrap: wrap">
      <el-input style="width: 320px" v-model="url" placeholder="Please input" class="input-with-select">
        <template #prepend>
          <el-select v-model="url_type" placeholder="Select" style="width: 100px" @change="selectUrl">
            <el-option v-for="item in url_options" :label="item.label" :value="item.value" />
          </el-select>
        </template>
      </el-input>
      <div style="display: flex; gap: 12px">
        <button @click="play">Start</button>
        <button @click="setFrameTrack" style="width: 160px">FrameTrack: {{ frame_track }}</button>
        <button @click="setPause" style="width: 120px">Pause: {{ pause }}</button>
        <button @click="cut">Cut</button>
        <button @click="setCutPause" style="width: 160px">Cut Pause: {{ cut_pause }}</button>
        <button @click="stop">Stop</button>
      </div>
    </div>
    <div class="play-view">
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
import { ref } from 'vue'
// import { PrPlayer } from 'pr-player'
// import { PrPlayer } from '../../dist/index'
import { PrPlayer } from '../../src/index'

const url_options = [
  { label: 'flv', value: 'https://sf1-cdn-tos.huoshanstatic.com/obj/media-fe/xgplayer_doc_video/flv/xgplayer-demo-720p.flv' },
  { label: 'flv-dy', value: 'https://pull-flv-f26.douyincdn.com/media/stream-694756842122773164.flv?arch_hrchy=w1&exp_hrchy=w1&expire=691af268&major_anchor_level=common&sign=51f8fb2c71a08a2f3af39d0b1f8d2284&t_id=037-20251110180112976F2FEA428EC19DFCFC-7nVaOR&unique_id=stream-694756842122773164_684_flv&_session_id=082-2025111018011269263710326FAD4B7EA8.1762768872692.60052&rsi=0&abr_pts=-800' },
  { label: 'flv-live', value: 'https://pull.pryun.vip/stream_5564094315/1763605928988.flv?auth_key=1763692328-0-0-c42f0978280e3d2e2eb0205fff4e0aaf' },
  { label: 'hls', value: 'https://sf1-cdn-tos.huoshanstatic.com/obj/media-fe/xgplayer_doc_video/hls/xgplayer-demo.m3u8' },
  { label: 'hls-live', value: 'https://pull.pryun.vip/stream_5564094315/1763605928988.m3u8?auth_key=1763692328-0-0-5f42eea1826ec6f039809f5bb2523ef0' },
  { label: 'hls-live-cf', value: 'https://customer-j8s1b2hyoi97nhi8.cloudflarestream.com/1a8f96645a804076b5536f3a22776560/manifest/video.m3u8' }
]

const url_type = ref<'flv' | 'hls' | 'flv-live' | 'hls-live' | 'hls-live-cf' | 'flv-dy'>('flv-dy')

const url = ref('')

const selectUrl = (_url: string) => {
  console.log('\x1b[38;2;0;151;255m%c%s\x1b[0m', 'color:#0097ff;', `------->Breathe: _url`, _url)
  url.value = _url
}

const init = () => {
  url.value = url_options.find((item) => item.label === url_type.value)?.value || ''
}
init()

const player = new PrPlayer({ debug: true })

const videoInfo = ref()
{
  player.on.demuxer.info = (info) => {
    videoInfo.value = info
    console.log('\x1b[38;2;0;151;255m%c%s\x1b[0m', 'color:#0097ff;', `------->Breathe: info`, info)
  }
  // player.on.demuxer.chunk = (chunk) => {
  //   console.log('\x1b[38;2;0;151;255m%c%s\x1b[0m', 'color:#0097ff;', `------->Breathe: chunk`, chunk)
  // }
  // player.on.demuxer.sei = (sei) => {
  //   console.log('\x1b[38;2;0;151;255m%c%s\x1b[0m', 'color:#0097ff;', `------->Breathe: sei`, sei)
  // }
}

{
  // player.on.decoder.audio = (audio) => {
  //   console.log('\x1b[38;2;0;151;255m%c%s\x1b[0m', 'color:#0097ff;', `------->Breathe: audio`, audio)
  // }
  // player.on.decoder.video = (video) => {
  //   console.log('\x1b[38;2;0;151;255m%c%s\x1b[0m', 'color:#0097ff;', `------->Breathe: video`, video)
  // }
}

const frame_track = ref(false)
const setFrameTrack = () => {
  frame_track.value = !frame_track.value
  player.setFrameTrack(frame_track.value)
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

  const stream = player.getStream()
  if (stream) {
    const dom = document.querySelector('#canvas-video-stream-view')
    const view = document.createElement('video')
    view.style.objectFit = 'cover'
    view.style.width = '100%'
    view.style.height = '100%'
    view.srcObject = stream
    view.play()
    dom?.replaceChildren(view)
  }
}

const cut = () => {
  cut_pause.value = false
  console.log('\x1b[38;2;0;151;255m%c%s\x1b[0m', 'color:#0097ff;', `------->Breathe: videoInfo.value `, videoInfo.value)
  const dom = document.querySelector('#canvas-video-stream-view')
  const { width = dom?.clientWidth, height = dom?.clientHeight } = videoInfo.value || {}
  player.cut.create('cut-any-key', { sx: width * 0.2, sy: height * 0.2, sw: width * 0.6, sh: height * 0.6 })

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
.pr-player {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-height: 100vh;
}
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
  min-width: 800px;
  max-width: 960px;
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
