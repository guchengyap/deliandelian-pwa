<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { PracticeFile } from '../db/db'
import { resolveSequence } from '../lib/sequence'
import type { PracticeTask } from '../lib/tasks'
import { stopAll } from '../lib/audioSession'
import AudioBar from './AudioBar.vue'
import ImageGrid from './ImageGrid.vue'

const props = defineProps<{
  task: PracticeTask
  done?: boolean
  groupLabel?: string
  /** 嵌在当日页卡片内：隐藏大标题与分组行，紧凑排布。 */
  embedded?: boolean
}>()
/** 音频/轮次播完自动打卡，携带 itemId 以支持当日页多实例。 */
const emit = defineEmits<{ autoDone: [itemId: string] }>()

const audios = computed<PracticeFile[]>(() =>
  (props.task.item.files ?? []).filter((f) => f.type === 'audio'),
)
const images = computed<PracticeFile[]>(() =>
  (props.task.item.files ?? []).filter((f) => f.type === 'image'),
)

/** plan + note 合并为一段次要诠释文本，无前缀。 */
const secondary = computed(() => {
  const { plan, note } = props.task.item
  return [plan, note].filter((v): v is string => !!v && v.length > 0).join(' ')
})

/** 把 config 参数翻译成人话徽标，让当日页也能看到完整练法。 */
const paramTags = computed<string[]>(() => {
  const c = props.task.item.config
  if (!c) return []
  const out: string[] = []
  const range = (v: unknown): string =>
    v && typeof v === 'object' && 'min' in v && 'max' in v
      ? `${(v as { min: number; max: number }).min}~${(v as { min: number; max: number }).max}`
      : String(v)
  if (c.sets != null) out.push(`${range(c.sets)} 组`)
  if (c.secondsPerSet != null) out.push(`每组 ${c.secondsPerSet} 秒`)
  if (c.restSeconds != null) out.push(`组间休息 ${c.restSeconds} 秒`)
  if (c.reps != null) out.push(`${range(c.reps)} 次`)
  if (c.secondsPerRep != null) out.push(`每次 ${c.secondsPerRep} 秒`)
  if (c.timer != null) out.push(`${c.timer} 秒`)
  return out
})

const sequence = computed<string[] | undefined>(() => props.task.item.config?.sequence)
const cursor = ref(0)
const seq = computed(() => resolveSequence(sequence.value, audios.value, cursor.value))

const roundLine = computed(() =>
  seq.value ? `第 ${seq.value.round} 轮 / 共 ${seq.value.total} 轮` : '',
)

// 音频条组件引用，供 sequence 自动切换下一首。
const bars = ref<InstanceType<typeof AudioBar>[]>([])

/** 本次进入该任务后已播完的音频 id，用于自动打卡判定。 */
const played = ref<Set<string>>(new Set())
/** 避免同一任务重复触发自动打卡。 */
let autoFired = false

function fireAutoDone() {
  if (autoFired || props.done || !audios.value.length) return
  autoFired = true
  emit('autoDone', props.task.item.id)
}

function barFor(fileId: string): InstanceType<typeof AudioBar> | undefined {
  const idx = audios.value.findIndex((f) => f.id === fileId)
  return idx >= 0 ? bars.value[idx] : undefined
}

/** 用户点击某音频条时，若处于 sequence，则高亮落到该条对应的 cursor。 */
function onUserPlay(fileId: string) {
  if (!sequence.value || !seq.value) return
  // 点当前正在播放的那一条时保持轮次，不因重复文件名跳回第一轮。
  if (seq.value.fileId === fileId) return
  const found = sequence.value.indexOf(fileId)
  if (found >= 0) cursor.value = found
}

/** 一首播完：sequence 模式下自动进入下一首/下一轮；播完该任务全部内容则自动打卡。 */
function onEnded(fileId: string) {
  played.value.add(fileId)
  if (!sequence.value || !seq.value) {
    // 普通项：所有音频都各播完一次即完成。
    if (audios.value.every((f) => played.value.has(f.id))) fireAutoDone()
    return
  }
  // 只允许 sequence 指定的当前项推进，避免手动点的旧音频干扰。
  if (seq.value.fileId !== fileId) return
  const next = cursor.value + 1
  if (next < sequence.value.length) {
    cursor.value = next
    const nextFile = resolveSequence(sequence.value, audios.value, next)
    if (nextFile) void barFor(nextFile.fileId)?.play()
  } else {
    // 走完整个序列（最后一轮最后一首）即完成。
    fireAutoDone()
  }
}

// 切换任务时复位轮播、播放状态与自动打卡标记，并停止播放。
watch(
  () => props.task.key,
  () => {
    stopAll()
    cursor.value = 0
    played.value = new Set()
    autoFired = false
  },
)
</script>

<template>
  <article class="task" :class="{ embedded }">
    <div v-if="roundLine" class="round">{{ roundLine }}</div>

    <template v-if="!embedded">
      <div class="group-line">{{ groupLabel }}</div>
      <h1 class="title">{{ task.no }}. {{ task.item.title }}</h1>
    </template>

    <div v-if="paramTags.length" class="params">
      <span v-for="(tag, i) in paramTags" :key="i" class="param">{{ tag }}</span>
    </div>

    <div v-if="audios.length" class="files audios">
      <AudioBar
        v-for="file in audios"
        :key="file.id"
        ref="bars"
        :file="file"
        :highlighted="!!seq && seq.fileId === file.id"
        @play="onUserPlay(file.id)"
        @ended="onEnded(file.id)"
      />
    </div>

    <div v-if="images.length" class="files images">
      <ImageGrid :files="images" :key="task.key" />
    </div>

    <p v-if="secondary" class="secondary">{{ secondary }}</p>
  </article>
</template>

<style scoped>
.task {
  width: 100%;
  max-width: 640px;
  margin: auto;
}
.group-line {
  font-size: 13px;
  color: var(--muted);
  margin-bottom: 6px;
}
.round {
  display: inline-block;
  font-size: 12px;
  color: var(--accent);
  border: none;
  background: var(--accent-soft);
  border-radius: 999px;
  padding: 3px 10px;
  margin-bottom: 14px;
}
.title {
  margin: 0 0 22px;
  font-size: 17px;
  font-weight: 500;
  line-height: 1.4;
  color: var(--text);
}
.files {
  margin-bottom: 4px;
}
.audios {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.secondary {
  margin: 10px 0 0;
  font-size: 13.5px;
  line-height: 1.5;
  color: var(--muted);
  font-weight: 400;
  background: none;
}
.params {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0 0 14px;
}
.param {
  font-size: 12px;
  line-height: 1.5;
  color: var(--muted);
  background: none;
  border: none;
  padding: 0;
}
.param + .param::before {
  content: '·';
  margin-right: 6px;
  color: var(--faint);
}
.embedded .round {
  margin-bottom: 10px;
}
.embedded .params {
  margin-bottom: 10px;
}
.embedded .secondary {
  margin-top: 8px;
}
</style>
