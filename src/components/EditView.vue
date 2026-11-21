<script setup lang="ts">
import { onMounted, reactive, ref, toRaw } from 'vue'
import seedData from '../db/seed.json'
import {
  db,
  type ItemConfig,
  type Level1Item,
  type Level2Item,
  type PracticeFile,
} from '../db/db'
import {
  deleteOpfsFile,
  invalidateFileUrl,
  resolveFileUrl,
  writeOpfsFile,
} from '../lib/opfsFiles'
import { uuid } from '../lib/uuid'

const emit = defineEmits<{ close: []; saved: [] }>()

onMounted(async () => {
  await loadDraft()
})

// ── 草稿 ────────────────────────────────────────────────
interface DraftGroup {
  id: string
  title: string
  items: Level2Item[]
}

const groups = ref<DraftGroup[]>([])
const configText = reactive<Record<string, string>>({})
const previews = reactive<Record<string, string>>({})
const message = ref('')
const saving = ref(false)
/** 载入时就存在的 opfs 文件，删除后需等保存再真正删；取消则保留。 */
const originalIds = new Set<string>()
const deletedIds = new Set<string>()

async function loadDraft() {
  const [l1, l2] = await Promise.all([
    db.level1.orderBy('order').toArray(),
    db.level2.orderBy('order').toArray(),
  ])
  groups.value = l1.map((first) => ({
    id: first.id,
    title: first.title,
    items: l2
      .filter((i) => i.level1_id === first.id)
      .sort((a, b) => a.order - b.order)
      .map((i) => structuredClone({ ...i, files: i.files ?? [] })),
  }))
  for (const g of groups.value) {
    for (const item of g.items) {
      configText[item.id] = item.config ? JSON.stringify(item.config, null, 2) : ''
      for (const f of item.files ?? []) {
        originalIds.add(f.id)
        previews[f.id] = await resolveFileUrl(f)
      }
    }
  }
}

function ensureFiles(item: Level2Item): PracticeFile[] {
  if (!item.files) item.files = []
  return item.files
}

// ── 增删改 ──────────────────────────────────────────────
const confirmGroupId = ref<string | null>(null)
const restoreConfirm = ref(false)

function addGroup() {
  groups.value.push({ id: uuid(), title: '新分组', items: [] })
}

function deleteGroup(id: string) {
  if (confirmGroupId.value !== id) {
    confirmGroupId.value = id
    return
  }
  const group = groups.value.find((g) => g.id === id)
  for (const item of group?.items ?? []) {
    for (const f of ensureFiles(item)) discardFile(f)
  }
  groups.value = groups.value.filter((g) => g.id !== id)
  confirmGroupId.value = null
}

function addItem(group: DraftGroup) {
  const id = uuid()
  group.items.push({ id, level1_id: group.id, order: group.items.length + 1, title: '新项目', files: [] })
  configText[id] = ''
}

function deleteItem(group: DraftGroup, id: string) {
  const item = group.items.find((i) => i.id === id)
  if (item) for (const f of ensureFiles(item)) discardFile(f)
  group.items = group.items.filter((i) => i.id !== id)
  delete configText[id]
}

function discardFile(file: PracticeFile) {
  // 本次会话新上传的文件立即清理；预置文件等保存时再删，取消可恢复。
  if (file.id.startsWith('u-')) void deleteOpfsFile(file.id)
  else if (originalIds.has(file.id)) deletedIds.add(file.id)
  invalidateFileUrl(file.id)
  delete previews[file.id]
}

function removeFile(item: Level2Item, file: PracticeFile) {
  discardFile(file)
  item.files = ensureFiles(item).filter((f) => f.id !== file.id)
}

// ── 拖拽排序 ────────────────────────────────────────────
type Drag =
  | { kind: 'group'; id: string }
  | { kind: 'item'; groupId: string; id: string }
let dragging: Drag | null = null

function startDrag(payload: Drag, e: DragEvent) {
  dragging = payload
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', payload.id)
  }
}

function dropGroup(targetId: string) {
  const drag = dragging
  if (drag?.kind !== 'group') return
  const from = groups.value.findIndex((g) => g.id === drag.id)
  const to = groups.value.findIndex((g) => g.id === targetId)
  if (from >= 0 && to >= 0 && from !== to) {
    const [moved] = groups.value.splice(from, 1)
    groups.value.splice(to, 0, moved)
  }
  dragging = null
}

function dropItem(targetGroupId: string, targetId: string) {
  const drag = dragging
  if (drag?.kind !== 'item') return
  const from = groups.value.find((g) => g.id === drag.groupId)
  const to = groups.value.find((g) => g.id === targetGroupId)
  if (!from || !to) return
  const idx = from.items.findIndex((i) => i.id === drag.id)
  if (idx < 0) return
  const [moved] = from.items.splice(idx, 1)
  moved.level1_id = to.id
  const targetIdx = to.items.findIndex((i) => i.id === targetId)
  to.items.splice(targetIdx < 0 ? to.items.length : targetIdx, 0, moved)
  dragging = null
}

// ── 上传 / 替换 ─────────────────────────────────────────
const fileInput = ref<HTMLInputElement | null>(null)
type UploadCtx = { groupId: string; itemId: string; mode: 'add' | 'replace'; fileId?: string }
let uploadCtx: UploadCtx | null = null

function pick(group: DraftGroup, item: Level2Item, mode: 'add' | 'replace', fileId?: string) {
  uploadCtx = { groupId: group.id, itemId: item.id, mode, fileId }
  fileInput.value?.click()
}

function mediaType(file: File): 'audio' | 'image' | null {
  if (file.type.startsWith('audio/')) return 'audio'
  if (file.type.startsWith('image/')) return 'image'
  return null
}

async function onFiles(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  const ctx = uploadCtx
  uploadCtx = null
  if (!ctx || !files.length) return
  const item = groups.value
    .find((g) => g.id === ctx.groupId)
    ?.items.find((i) => i.id === ctx.itemId)
  if (!item) return

  let accepted = 0
  let rejected = false
  try {
    if (ctx.mode === 'add') {
      for (const file of files) {
        const type = mediaType(file)
        if (!type) {
          rejected = true
          continue
        }
        const id = `u-${uuid()}`
        await writeOpfsFile(id, file)
        const ref: PracticeFile = { id, name: file.name, type, path: `files/${id}`, mime: file.type }
        ensureFiles(item).push(ref)
        previews[id] = await resolveFileUrl(ref)
        accepted += 1
      }
    } else {
      const file = files[0]
      const type = mediaType(file)
      if (!type) rejected = true
      else {
        const target = ensureFiles(item).find((f) => f.id === ctx.fileId)
        if (target) {
          await writeOpfsFile(target.id, file)
          target.name = file.name
          target.type = type
          target.mime = file.type
          invalidateFileUrl(target.id)
          previews[target.id] = await resolveFileUrl(target)
          accepted += 1
        }
      }
    }
    message.value = rejected ? '仅支持音频和图片' : accepted ? '文件已写入本机 OPFS' : ''
  } catch {
    message.value = '写入失败：当前浏览器不支持 OPFS 同步写入'
  }
}

// ── 恢复预置 / 保存 ─────────────────────────────────────
function restorePreset() {
  if (!restoreConfirm.value) {
    restoreConfirm.value = true
    return
  }
  const seed = structuredClone(seedData)
  const l1s = seed.level1 as Level1Item[]
  const l2s = seed.level2 as unknown as Level2Item[]
  groups.value = l1s.map((l1) => ({
    id: l1.id,
    title: l1.title,
    items: l2s
      .filter((i) => i.level1_id === l1.id)
      .map((i) => {
        const remap = new Map<string, string>()
        const files = (i.files ?? []).map((f: PracticeFile) => {
          const id = `p-${uuid()}`
          remap.set(f.id, id)
          return { ...f, id }
        })
        const config = i.config ? { ...i.config } : undefined
        if (config?.sequence) config.sequence = config.sequence.map((id) => remap.get(id) ?? id)
        return { ...i, files, config }
      }),
  }))
  for (const g of groups.value) {
    for (const item of g.items) {
      configText[item.id] = item.config ? JSON.stringify(item.config, null, 2) : ''
      for (const f of ensureFiles(item)) delete previews[f.id]
    }
  }
  restoreConfirm.value = false
  message.value = '已载入预置方案草稿，点击保存生效（原 OPFS 文件保留但不再引用）'
}

/** 草稿位于 ref 中是响应式 Proxy，写 IndexedDB 前必须转成普通对象。 */
function deepRaw<T>(value: T): T {
  const raw = toRaw(value)
  if (Array.isArray(raw)) return raw.map(deepRaw) as T
  if (raw && typeof raw === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(raw)) out[key] = deepRaw(val)
    return out as T
  }
  return raw
}

function cleanItem(item: Level2Item, level1_id: string, order: number): Level2Item {
  const out: Level2Item = { id: item.id, level1_id, order, title: item.title.trim() }
  if (item.files?.length) out.files = item.files
  if (item.note?.trim()) out.note = item.note
  if (item.plan?.trim()) out.plan = item.plan
  if (item.config && Object.keys(item.config).length) out.config = item.config
  return out
}

async function save() {
  message.value = ''
  // 先校验所有 JSON，避免写库写到一半失败。
  for (const g of groups.value) {
    if (!g.title.trim()) {
      message.value = '一级项标题不能为空'
      return
    }
    for (const item of g.items) {
      if (!item.title.trim()) {
        message.value = '二级项标题不能为空'
        return
      }
      const text = (configText[item.id] ?? '').trim()
      if (!text) {
        item.config = undefined
        continue
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        message.value = `「${item.title}」的 config 不是有效 JSON`
        return
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        message.value = `「${item.title}」的 config 必须是对象`
        return
      }
      item.config = parsed as ItemConfig
    }
  }

  saving.value = true
  try {
    await db.transaction('rw', db.level1, db.level2, async () => {
      await db.level1.clear()
      await db.level2.clear()
      await db.level1.bulkAdd(
        deepRaw(groups.value.map((g, i) => ({ id: g.id, order: i + 1, title: g.title.trim() }))),
      )
      await db.level2.bulkAdd(
        deepRaw(
          groups.value.flatMap((g) => g.items.map((item, i) => cleanItem(item, g.id, i + 1))),
        ),
      )
    })
    for (const id of deletedIds) await deleteOpfsFile(id)
    deletedIds.clear()
    for (const g of groups.value) {
      for (const item of g.items) {
        for (const f of ensureFiles(item)) invalidateFileUrl(f.id)
      }
    }
    emit('saved')
  } catch (err) {
    message.value = `保存失败：${String(err)}`
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="edit">
    <header class="bar">
      <button type="button" class="back" @click="emit('close')">‹ 返回</button>
      <h1>维护模式</h1>
    </header>

    <div class="toolbar">
        <button type="button" class="ghost" :class="{ armed: restoreConfirm }" @click="restorePreset">
          {{ restoreConfirm ? '确认恢复？' : '恢复预置方案' }}
        </button>
        <button v-if="restoreConfirm" type="button" class="ghost" @click="restoreConfirm = false">取消</button>
        <span class="msg">{{ message }}</span>
      </div>

      <div class="body">
        <section v-for="g in groups" :key="g.id" class="group">
          <div class="group-head" @dragover.prevent @drop.prevent="dropGroup(g.id)">
            <span
              class="handle"
              draggable="true"
              title="拖拽排序"
              @dragstart="startDrag({ kind: 'group', id: g.id }, $event)"
              >⠿</span
            >
            <input v-model="g.title" class="g-title" aria-label="一级项标题" />
            <button type="button" class="danger" @click="deleteGroup(g.id)">
              {{ confirmGroupId === g.id ? '确认删除？' : '删除' }}
            </button>
            <button v-if="confirmGroupId === g.id" type="button" class="ghost" @click="confirmGroupId = null">
              取消
            </button>
          </div>
          <p v-if="confirmGroupId === g.id" class="warn">将连带删除其下 {{ g.items.length }} 个二级项</p>

          <div
            v-for="item in g.items"
            :key="item.id"
            class="item"
            @dragover.prevent
            @drop.prevent="dropItem(g.id, item.id)"
          >
            <div class="item-head">
              <span
                class="handle"
                draggable="true"
                title="拖拽排序"
                @dragstart="startDrag({ kind: 'item', groupId: g.id, id: item.id }, $event)"
                >⠿</span
              >
              <input v-model="item.title" class="i-title" placeholder="标题" aria-label="二级项标题" />
              <button type="button" class="danger" @click="deleteItem(g, item.id)">删除</button>
            </div>

            <label class="field">
              <span>注释</span>
              <textarea v-model="item.note" rows="2" placeholder="可选" />
            </label>
            <label class="field">
              <span>练习</span>
              <textarea v-model="item.plan" rows="2" placeholder="可选" />
            </label>
            <label class="field">
              <span>config（可选 JSON）</span>
              <textarea v-model="configText[item.id]" rows="3" placeholder='例如 {"timer":60}' />
            </label>

            <div class="files">
              <div v-for="f in item.files ?? []" :key="f.id" class="frow">
                <audio v-if="f.type === 'audio'" :src="previews[f.id]" controls class="prev-audio" />
                <img v-else :src="previews[f.id]" class="prev-img" :alt="f.name" />
                <span class="fname" :title="f.name">{{ f.name }}</span>
                <button type="button" class="ghost" @click="pick(g, item, 'replace', f.id)">替换</button>
                <button type="button" class="danger" @click="removeFile(item, f)">删除</button>
              </div>
            </div>
            <button type="button" class="upload" @click="pick(g, item, 'add')">＋ 上传文件</button>
          </div>

          <button type="button" class="add-line" @click="addItem(g)">＋ 新增二级项</button>
        </section>

        <button type="button" class="add-line main" @click="addGroup">＋ 新增一级项</button>
      </div>

      <footer class="footer">
        <button type="button" class="ghost" @click="emit('close')">取消</button>
        <button type="button" class="primary" :disabled="saving" @click="save">
          {{ saving ? '保存中…' : '保存' }}
        </button>
      </footer>

    <input
      ref="fileInput"
      type="file"
      multiple
      accept="audio/*,image/*"
      hidden
      @change="onFiles"
    />
  </div>
</template>

<style scoped>
.edit {
  display: flex;
  flex-direction: column;
  height: 100dvh;
  min-height: 0;
}
.bar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--line);
}
.bar h1 {
  margin: 0;
  font-size: 18px;
  font-weight: 500;
}
.back {
  border: none;
  background: none;
  color: var(--accent);
  font-size: 15px;
  cursor: pointer;
  padding: 4px 0;
}
.field textarea,
.g-title,
.i-title {
  width: 100%;
  border: none;
  border-radius: var(--r-s);
  background: var(--fill);
  color: var(--text);
  padding: 10px 12px;
  font-size: 14px;
  font-family: inherit;
}
.error {
  margin: 0;
  font-size: 13px;
  color: #e0300e;
}
.toolbar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 20px;
  border-bottom: 1px solid var(--line);
}
.msg {
  font-size: 12px;
  color: var(--muted);
  margin-left: auto;
  text-align: right;
}
.body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 20px 28px;
  scrollbar-width: thin;
  scrollbar-color: rgba(60,60,67,0.25) transparent;
}
.group {
  max-width: 720px;
  margin: 0 auto 22px;
  border: none;
  border-radius: var(--r-m);
  padding: 14px;
    background: var(--card-glass);
  border: 1px solid var(--card-glass-border);
  -webkit-backdrop-filter: var(--card-blur);
  backdrop-filter: var(--card-blur);
  box-shadow: var(--card-glass-shadow);
  transition: background 0.5s ease, box-shadow 0.5s ease, border-color 0.5s ease;

}
.group-head,
.item-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.group-head {
  margin-bottom: 12px;
}
.handle {
  flex: 0 0 auto;
  cursor: grab;
  color: var(--muted);
  font-size: 18px;
  padding: 0 4px;
  user-select: none;
}
.g-title {
  flex: 1;
  font-weight: 500;
}
.i-title {
  flex: 1;
}
.item {
  border-top: 1px solid var(--line);
  padding: 14px 0 4px;
  margin-top: 12px;
}
.item-head {
  margin-bottom: 10px;
}
.field {
  display: block;
  margin-bottom: 10px;
}
.field span {
  display: block;
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 4px;
}
.field textarea {
  resize: vertical;
  line-height: 1.5;
}
.files {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 10px 0;
}
.frow {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: none;
  border-radius: var(--r-s);
  background: var(--fill);
}
.prev-audio {
  flex: 0 0 180px;
  width: 180px;
  height: 32px;
}
.prev-img {
  flex: 0 0 auto;
  width: 72px;
  height: 44px;
  object-fit: cover;
  border-radius: 4px;
  background: var(--bg);
}
.fname {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 12px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
button {
  border: none;
  background: var(--fill);
  color: var(--text);
  border-radius: var(--r-s);
  padding: 6px 10px;
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  white-space: nowrap;
}
button.ghost {
  color: var(--muted);
}
button.ghost.armed {
  color: #e0300e;
  border-color: #e0300e;
}
button.danger {
  color: #e0300e;
}
button.add-line {
  display: block;
  width: 100%;
  margin-top: 10px;
  background: transparent;
  box-shadow: inset 0 0 0 1px var(--accent-line);
  color: var(--accent);
}
button.add-line.main {
  max-width: 720px;
  margin: 0 auto;
}
button.upload {
  color: var(--accent);
}
button.primary {
  background: var(--accent);
  color: #fff;
  font-weight: 500;
  padding: 10px 20px;
}
button:disabled {
  opacity: 0.5;
  cursor: default;
}
.warn {
  margin: 0 0 8px;
  font-size: 12px;
  color: #e0300e;
}
.footer {
  flex: 0 0 auto;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 12px 20px;
  padding-bottom: max(12px, env(safe-area-inset-bottom));
  border-top: 1px solid var(--hairline);
  background: var(--glass);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  backdrop-filter: blur(24px) saturate(180%);
}
@media (max-width: 560px) {
  .bar,
  .toolbar,
  .footer {
    padding-left: 14px;
    padding-right: 14px;
  }
  .body {
    padding-left: 14px;
    padding-right: 14px;
  }
  .prev-audio {
    flex-basis: 120px;
    width: 120px;
  }
}
</style>
