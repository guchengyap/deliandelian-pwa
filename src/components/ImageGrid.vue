<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import Viewer from 'viewerjs'
import 'viewerjs/dist/viewer.css'
import type { PracticeFile } from '../db/db'
import { resolveFileUrl } from '../lib/opfsFiles'

const props = defineProps<{ files: PracticeFile[] }>()

const root = ref<HTMLElement | null>(null)
const srcs = reactive<Record<string, string>>({})
let viewer: Viewer | null = null

async function resolveAll() {
  for (const file of props.files) srcs[file.id] = await resolveFileUrl(file)
}

function options(): Viewer.Options {
  return {
    // 半透明黑遮罩；点击遮罩关闭由 Viewer 默认行为提供。
    backdrop: true,
    // 右上角关闭按钮
    button: true,
    // 键盘 / 触摸滑动切换、双指缩放
    keyboard: true,
    slideOnTouch: true,
    zoomOnTouch: true,
    zoomOnGesture: true,
    movable: true,
    zoomable: true,
    rotatable: false,
    scalable: false,
    transition: true,
    navbar: false,
    title: false,
    toolbar: {
      zoomIn: true,
      zoomOut: true,
      oneToOne: true,
      reset: true,
      prev: true,
      next: true,
    },
  }
}

function rebuild() {
  viewer?.destroy()
  viewer = null
  if (root.value) viewer = new Viewer(root.value, options())
}

onMounted(() => {
  rebuild()
  void resolveAll()
})
onBeforeUnmount(() => {
  viewer?.destroy()
  viewer = null
})

// 任务切换导致图片节点变化时重建 Viewer 绑定并重新解析路径。
watch(
  () => props.files,
  () => {
    rebuild()
    void resolveAll()
  },
)
</script>

<template>
  <div ref="root" class="grid">
    <figure v-for="file in props.files" :key="file.id" class="cell">
      <img :src="srcs[file.id] || file.path" :alt="file.name" loading="lazy" />
      <figcaption :title="file.name">{{ file.name }}</figcaption>
    </figure>
  </div>
</template>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}
.cell {
  margin: 0;
  min-width: 0;
}
.cell img {
  display: block;
  width: 100%;
  aspect-ratio: 16 / 9;
  object-fit: cover;
  border-radius: var(--r-s);
  background: var(--fill);
  cursor: zoom-in;
}
.cell figcaption {
  margin-top: 4px;
  font-size: 12px;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>

<style>
/* Viewer.js 生成在 body 下，需全局样式约束图片尺寸与遮罩。 */
.viewer-container .viewer-canvas > img {
  max-width: 80vw;
  max-height: 80vh;
  object-fit: contain;
}
.viewer-backdrop {
  background-color: rgba(0, 0, 0, 0.86) !important;
}
</style>
