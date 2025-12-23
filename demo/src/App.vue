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
  { label: 'flv-live', value: 'https://pull.pryun.vip/stream_4627451267/1765432331029.flv?auth_key=1765518731-0-0-bf7549bd8feea7566946d2a5ea33fe3a' },
  {
    label: 'flv-dy',
    value:
      'https://v23aamqnzch6sm43unthes3exvguvil8v.mobgslb.tbcache.com/pull-f3.douyincdn.com/media/stream-118480348615017132.flv?rsi=1&major_anchor_level=common&abr_pts=-800&unique_id=stream-118480348615017132_684_flv&arch_hrchy=w1&t_id=037-202512231508056044D30C3EB64271698C-EdrmE2&exp_hrchy=w1&auth_key=1767076685-0-0-9240cb267bfeca1faf6189d7a2c6759f&_session_id=037-202512231508056044D30C3EB64271698C-EdrmE2.1766473685643.24745&ali_302c=701&ali_dispatch_cold_stream=on&ali_redirect_ex_hot=66666101&ali_stream_type=01&ali_orig_station=cn8234&ali_st=cn7489&ali_pv=1766473658&ali_ts=1766473686&ali_g=t51'
  },

  { label: 'hls', value: 'https://sf1-cdn-tos.huoshanstatic.com/obj/media-fe/xgplayer_doc_video/hls/xgplayer-demo.m3u8' },
  { label: 'hls-live', value: 'https://pull.pryun.vip/stream_1234567890/1764052786653.m3u8?auth_key=1764139186-0-0-315d20cbd0450f662b4c4eabc6cf969d' },
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
  player.on.decoder.analysis = (_e) => {
    // console.log('\x1b[38;2;0;151;255m%c%s\x1b[0m', 'color:#0097ff;', `------->Breathe: analysis`, _e)
  }
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
  try {
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
  } catch (error) {
    console.log('\x1b[38;2;0;151;255m%c%s\x1b[0m', 'color:#0097ff;', `------->Breathe: error`, error)
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
