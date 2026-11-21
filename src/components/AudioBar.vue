<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { PracticeFile } from '../db/db'
import { activateAudioSession, isCurrent, setPlaybackState, takeOver } from '../lib/audioSession'
import { resolveFileUrl } from '../lib/opfsFiles'

const props = defineProps<{
  file: PracticeFile
  /** 在 config.sequence 轮播中是否为当前应播放项 */
  highlighted?: boolean
}>()

const emit = defineEmits<{ ended: []; play: [] }>()

const el = ref<HTMLAudioElement | null>(null)
const playing = ref(false)
const currentTime = ref(0)
const duration = ref(0)
const failed = ref(false)
/** OPFS 优先解析后的实际播放地址；初始用 path，解析完成后替换。 */
const src = ref(props.file.path)

const progress = computed(() => {
  if (!Number.isFinite(duration.value) || duration.value <= 0) return 0
  return Math.min(100, (currentTime.value / duration.value) * 100)
})

function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '--:--'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function onTimeUpdate(e: Event) {
  currentTime.value = (e.target as HTMLAudioElement).currentTime
}
function onMeta(e: Event) {
  duration.value = (e.target as HTMLAudioElement).duration
}
function onPlay() {
  playing.value = true
  setPlaybackState('playing')
}
function onPause() {
  playing.value = false
  if (el.value && isCurrent(el.value)) setPlaybackState('paused')
}
function onEnded() {
  playing.value = false
  setPlaybackState('paused')
  emit('ended')
}
function onError() {
  failed.value = true
}

async function toggle() {
  const audio = el.value
  if (!audio) return
  if (audio.paused) {
    // 用户手势中激活音频会话（首次点击），随后开始播放。
    activateAudioSession(audio)
    takeOver(audio, props.file)
    try {
      await audio.play()
      emit('play')
    } catch {
      failed.value = true
    }
  } else {
    audio.pause()
  }
}

/** 由 sequence 轮播驱动：直接播，但仍需处于用户手势链中。 */
async function play() {
  const audio = el.value
  if (!audio) return
  activateAudioSession(audio)
  takeOver(audio, props.file)
  try {
    await audio.play()
  } catch {
    failed.value = true
  }
}

defineExpose({ play })

watch(
  () => [props.file.id, props.file.path],
  async () => {
    playing.value = false
    currentTime.value = 0
    duration.value = 0
    failed.value = false
    src.value = await resolveFileUrl(props.file)
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  if (el.value && isCurrent(el.value)) {
    el.value.pause()
    setPlaybackState('paused')
  }
})
</script>

<template>
  <div class="audio-bar" :class="{ highlight: highlighted, playing }">
    <button
      class="play"
      type="button"
      :aria-label="playing ? '暂停' : '播放'"
      @click="toggle"
    >
      <svg v-if="!playing" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8 5.5v13l11-6.5z" fill="currentColor" />
      </svg>
      <svg v-else viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 5h3.5v14H7zm6.5 0H17v14h-3.5z" fill="currentColor" />
      </svg>
    </button>

    <div class="body">
      <div class="name" :title="file.name">{{ file.name }}</div>
      <div class="track">
        <div class="fill" :style="{ width: progress + '%' }" />
      </div>
    </div>

    <span class="dur">{{ failed ? '不可用' : fmt(duration) }}</span>

    <audio
      ref="el"
      :src="src"
      :type="file.mime"
      playsinline
      preload="auto"
      @timeupdate="onTimeUpdate"
      @loadedmetadata="onMeta"
      @durationchange="onMeta"
      @play="onPlay"
      @pause="onPause"
      @ended="onEnded"
      @error="onError"
    />
  </div>
</template>

<style scoped>
.audio-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 9px 12px;
  border-radius: var(--r-s);
  transition: background 0.3s var(--ease);
}
.audio-bar.highlight {
  background: var(--accent-bg);
}
.play {
  flex: 0 0 auto;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: none;
  background: var(--accent-color);
  color: #fff;
  box-shadow: 0 4px 16px var(--shadow-color);
  display: grid;
  place-items: center;
  cursor: pointer;
  padding: 0;
}
.play svg {
  width: 18px;
  height: 18px;
}
.body {
  flex: 1 1 auto;
  min-width: 0;
}
.name {
  font-size: 14px;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.4;
}
.track {
  margin-top: 7px;
  height: 2px;
  border-radius: 2px;
  background: var(--track);
  overflow: hidden;
}
.fill {
  height: 100%;
  background: var(--accent);
  width: 0;
  transition: width 0.15s linear;
}
.dur {
  flex: 0 0 auto;
  font-size: 12px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
  min-width: 38px;
  text-align: right;
}
</style>
