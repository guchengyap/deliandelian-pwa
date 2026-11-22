<script setup lang="ts">
import { computed, onMounted, reactive, ref, toRaw } from 'vue'
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
import { auth, refreshUsage } from '../lib/auth'
import { STORAGE_LIMIT } from '../config'
import {
  QuotaError,
  canWriteCloud,
  cloudFileUrl,
  deleteCloudFileQuiet,
  remainingBytes,
  saveSpace,
  uploadCloudFile,
} from '../lib/cloudSpace'
import { uuid } from '../lib/uuid'
import StorageRing from './StorageRing.vue'
import CloudFilesDialog from './CloudFilesDialog.vue'

const emit = defineEmits<{ close: []; saved: [] }>()

onMounted(async () => {
  await loadDraft()
  void refreshUsage()
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
/** 云端文件上传状态（维护页行内反馈）：uploading → done/error。 */
const uploadStates = reactive<Record<string, 'uploading' | 'done' | 'error'>>({})
/** 本会话新上传的云端文件（取消维护时需清理）；保存后移出。 */
const newCloudIds = new Set<string>()
/** 保存成功后才真正从云端删除的旧文件（取消可恢复）。 */
const deletedCloudIds = new Set<string>()
/** 云端文件管理弹层 */
const showFiles = ref(false)
/** 容量不足引导：剩余 / 当前文件（打开弹窗，可直接去清理） */
const quotaNotice = ref<{ remaining: number; incoming: number } | null>(null)

/** 顶部容量栏使用：实时用量（删除文件后会随 auth.usage 立即更新）。 */
const usage = computed(() => ({
  usedBytes: auth.usage?.used ?? 0,
  quotaBytes: auth.usage?.limit || STORAGE_LIMIT,
}))

/** 草稿里的引用关系：cloud_id → 项目标题（删除文件时的"正被引用"提示用）。 */
const draftRefMap = computed<Record<string, string>>(() => {
  const map: Record<string, string> = {}
  for (const g of groups.value) {
    for (const item of g.items) {
      for (const f of item.files ?? []) {
        if (f.cloud_id) map[f.cloud_id] = item.title.trim() || '未命名项目'
      }
    }
  }
  return map
})

/** 剩余可用字节（与后端 usedBytes/quotaBytes 同源，避免两边判断不一致）。 */
function cloudRemaining(): number {
  return remainingBytes(usage.value)
}

/** 上传前本地预检：超了就拦截并弹「空间不足」引导，而不是白传到一半失败。 */
function overQuota(size: number): boolean {
  const remain = cloudRemaining()
  if (size <= remain) return false
  quotaNotice.value = { remaining: remain, incoming: size }
  return true
}

/** 文件管理弹层里删了文件：把草稿中已失效的素材一并移除，并刷新容量。 */
function onFilesChanged(payload: { usedBytes: number; quotaBytes: number; deletedIds: string[] }) {
  const gone = new Set(payload.deletedIds)
  if (!gone.size) return
  for (const g of groups.value) {
    for (const item of g.items) {
      const files = item.files ?? []
      if (!files.some((f) => f.cloud_id && gone.has(f.cloud_id))) continue
      for (const f of files) {
        if (f.cloud_id && gone.has(f.cloud_id)) {
          invalidateFileUrl(f.id)
          delete previews[f.id]
          delete uploadStates[f.id]
        }
      }
      item.files = files.filter((f) => !(f.cloud_id && gone.has(f.cloud_id)))
    }
  }
  message.value = `已删除 ${gone.size} 个云端文件，对应素材已从草稿移除`
}

/** 「去清理旧文件」：关闭提示，直接打开云端文件管理。 */
function goCleanup() {
  quotaNotice.value = null
  showFiles.value = true
}

const mb = (bytes?: number) => `${((bytes ?? 0) / 1024 / 1024).toFixed(1)} MB`

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
  if (file.cloud_id) {
    // 云端文件：本会话新上传的立即删；原有文件等保存成功再删，取消维护可恢复。
    if (newCloudIds.has(file.cloud_id)) void deleteCloudFileQuiet(file.cloud_id)
    else deletedCloudIds.add(file.cloud_id)
  } else if (file.id.startsWith('u-')) void deleteOpfsFile(file.id)
  else if (originalIds.has(file.id)) deletedIds.add(file.id)
  invalidateFileUrl(file.id)
  delete previews[file.id]
  delete uploadStates[file.id]
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

  const useCloud = canWriteCloud()
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
        // 上传前本地预检：超出剩余容量直接拦截，弹「空间不足」引导清理
        if (useCloud && overQuota(file.size)) continue
        const id = `u-${uuid()}`
        const ref: PracticeFile = {
          id,
          name: file.name,
          type,
          path: useCloud ? '' : `files/${id}`,
          mime: file.type,
        }
        if (useCloud) {
          // 先占位让行内出现"上传中…"状态，上传完成后再补 cloud_id 与大小。
          uploadStates[id] = 'uploading'
          ensureFiles(item).push(ref)
          previews[id] = ''
        }
        try {
          if (useCloud) {
            const up = await uploadCloudFile(file)
            ref.cloud_id = up.id
            ref.size = up.size
            newCloudIds.add(up.id)
            previews[id] = cloudFileUrl(up.id)
            uploadStates[id] = 'done'
            void refreshUsage()
          } else {
            await writeOpfsFile(id, file)
            previews[id] = await resolveFileUrl(ref)
          }
          accepted += 1
        } catch (err) {
          if (!useCloud) throw err
          // 上传失败（含服务端 120MB 超额）：移除占位，行内恢复原状并提示。
          item.files = ensureFiles(item).filter((f) => f.id !== id)
          delete previews[id]
          delete uploadStates[id]
          if (err instanceof QuotaError) {
            // 服务端判定超额（客户端数字过期时的兜底）：弹同一引导
            quotaNotice.value = { remaining: err.remainingBytes, incoming: err.incomingBytes }
          } else {
            message.value = err instanceof Error ? err.message : '上传失败，请重试'
          }
        }
      }
    } else {
      const file = files[0]
      const type = mediaType(file)
      if (!type) rejected = true
      else {
        const target = ensureFiles(item).find((f) => f.id === ctx.fileId)
        if (target) {
          if (useCloud && overQuota(file.size)) {
            // 已弹「空间不足」引导，不发起上传
          } else if (useCloud) {
            uploadStates[target.id] = 'uploading'
            try {
              const up = await uploadCloudFile(file)
              const oldCloud = target.cloud_id
              target.cloud_id = up.id
              target.size = up.size
              target.name = file.name
              target.type = type
              target.mime = file.type
              newCloudIds.add(up.id)
              if (oldCloud) {
                if (newCloudIds.has(oldCloud)) void deleteCloudFileQuiet(oldCloud)
                else deletedCloudIds.add(oldCloud)
              }
              previews[target.id] = cloudFileUrl(up.id)
              uploadStates[target.id] = 'done'
              void refreshUsage()
              accepted += 1
            } catch (err) {
              uploadStates[target.id] = 'error'
              if (err instanceof QuotaError) {
                quotaNotice.value = { remaining: err.remainingBytes, incoming: err.incomingBytes }
              } else {
                message.value = err instanceof Error ? err.message : '上传失败，请重试'
              }
            }
          } else {
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
    }
    if (!useCloud) message.value = rejected ? '仅支持音频和图片' : accepted ? '文件已写入本机 OPFS' : ''
    else if (rejected && !message.value) message.value = '仅支持音频和图片'
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
    const l1rows = deepRaw(
      groups.value.map((g, i) => ({ id: g.id, order: i + 1, title: g.title.trim() })),
    )
    const l2rows = deepRaw(
      groups.value.flatMap((g) => g.items.map((item, i) => cleanItem(item, g.id, i + 1))),
    )
    await db.transaction('rw', db.level1, db.level2, async () => {
      await db.level1.clear()
      await db.level2.clear()
      await db.level1.bulkAdd(l1rows)
      await db.level2.bulkAdd(l2rows)
    })
    // 云端：先完成空间同步，再清理已删除的云端文件；任一步失败则留在维护模式重试。
    if (canWriteCloud()) {
      await saveSpace({ level1: l1rows, level2: l2rows })
      for (const cid of deletedCloudIds) await deleteCloudFileQuiet(cid)
      deletedCloudIds.clear()
      void refreshUsage()
    }
    for (const id of deletedIds) await deleteOpfsFile(id)
    deletedIds.clear()
    for (const g of groups.value) {
      for (const item of g.items) {
        for (const f of ensureFiles(item)) invalidateFileUrl(f.id)
      }
    }
    emit('saved')
  } catch (err) {
    message.value = `保存失败：${err instanceof Error ? err.message : String(err)}（数据未丢失，请重试）`
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

      <!-- 顶部容量栏：镂空圆环 + 精确用量 + 文件管理入口 -->
      <div v-if="canWriteCloud()" class="capacity">
        <StorageRing :used="usage.usedBytes" :quota="usage.quotaBytes" :size="46" :stroke="5" compact />
        <button type="button" class="mini" @click="showFiles = true">管理云端文件</button>
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
                <audio v-if="f.type === 'audio' && previews[f.id]" :src="previews[f.id]" controls class="prev-audio" />
                <img v-else-if="f.type === 'image' && previews[f.id]" :src="previews[f.id]" class="prev-img" :alt="f.name" />
                <span v-else class="prev-wait" aria-hidden="true">…</span>
                <span class="fname" :title="f.name">{{ f.name }}</span>
                <span v-if="uploadStates[f.id] === 'uploading'" class="fstate uploading">上传中…</span>
                <span v-else-if="uploadStates[f.id] === 'done'" class="fstate done">已上传 ✓ {{ f.size ? mb(f.size) : '' }}</span>
                <span v-else-if="f.size" class="fstate">{{ mb(f.size) }}</span>
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
          {{ saving ? '保存中…' : '保存并退出维护' }}
        </button>
      </footer>

    <CloudFilesDialog
      v-if="showFiles"
      :ref-map="draftRefMap"
      @close="showFiles = false"
      @changed="onFilesChanged"
    />

    <!-- 空间不足引导：拦截上传 + 一键去清理旧文件 -->
    <Teleport to="body">
      <div v-if="quotaNotice" class="q-mask" role="presentation" @click.self="quotaNotice = null">
        <div class="q-card" role="alertdialog" aria-modal="true" aria-label="空间不足">
          <h3>空间不足</h3>
          <p class="q-line">
            剩余 <b>{{ mb(quotaNotice.remaining) }}</b>，当前文件 <b>{{ mb(quotaNotice.incoming) }}</b>。
          </p>
          <p class="q-sub">删除不用的旧音频、图片即可释放空间，删除后立即生效。</p>
          <div class="q-acts">
            <button type="button" class="ghost" @click="quotaNotice = null">取消</button>
            <button type="button" class="primary" @click="goCleanup">去清理旧文件</button>
          </div>
        </div>
      </div>
    </Teleport>

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
/* 顶部容量栏 */
.capacity {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 20px;
  border-bottom: 1px solid var(--line);
}
.capacity .mini {
  border: none;
  background: var(--fill);
  color: var(--accent);
  border-radius: 999px;
  font-size: 12px;
  padding: 6px 14px;
  cursor: pointer;
}
.msg {
  font-size: 12px;
  color: var(--muted);
  margin-left: auto;
  text-align: right;
}
/* 空间不足弹窗 */
.q-mask {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(0, 0, 0, 0.3);
  -webkit-backdrop-filter: blur(6px);
  backdrop-filter: blur(6px);
}
.q-card {
  width: min(360px, 100%);
  background: var(--card);
  color: var(--text);
  border-radius: var(--r-l);
  padding: 20px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.3);
}
.q-card h3 {
  margin: 0 0 10px;
  font-size: 16px;
  font-weight: 600;
}
.q-line {
  margin: 0 0 8px;
  font-size: 14px;
  line-height: 1.5;
}
.q-line b {
  color: #e0300e;
  font-variant-numeric: tabular-nums;
}
.q-sub {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
  line-height: 1.5;
}
.q-acts {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 18px;
}
.q-acts button {
  font-size: 13px;
  padding: 9px 18px;
  border-radius: 999px;
}
.fstate {
  flex: 0 0 auto;
  font-size: 11px;
  color: var(--muted);
  white-space: nowrap;
}
.fstate.uploading {
  color: var(--muted);
}
.fstate.done {
  color: var(--accent);
}
.prev-wait {
  flex: 0 0 44px;
  width: 44px;
  text-align: center;
  color: var(--muted);
  font-size: 16px;
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
  .footer,
  .capacity {
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
