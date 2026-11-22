<script setup lang="ts">
/**
 * 云端文件管理弹层：列出当前账号已上传的文件，支持单个/批量删除。
 *
 * - 删除前二次确认；若文件正被当前空间的项目引用，明确提示「删除后素材将失效」；
 * - 删除成功后重新拉取列表并同步 auth.usage，容量环立即更新，无需刷新页面；
 * - 手机端可用：整屏弹层、行内换行、底部安全区留白。
 */
import { computed, onMounted, ref } from 'vue'
import { db } from '../db/db'
import {
  deleteCloudFile,
  listCloudFiles,
  type CloudFileMeta,
  type FileUsage,
} from '../lib/cloudSpace'
import StorageRing from './StorageRing.vue'

const props = defineProps<{
  /** cloud_id → 项目标题映射；不传则从本机当前空间（IndexedDB）自动推导。 */
  refMap?: Record<string, string>
}>()

const emit = defineEmits<{
  close: []
  changed: [payload: FileUsage & { deletedIds: string[] }]
}>()

const loading = ref(true)
const error = ref('')
const files = ref<CloudFileMeta[]>([])
const usedBytes = ref(0)
const quotaBytes = ref(120 * 1024 * 1024)
const selected = ref<string[]>([])
const pending = ref<string[] | null>(null)
const deleting = ref(false)
const localRefMap = ref<Record<string, string>>({})

const refMap = computed(() => props.refMap ?? localRefMap.value)

const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1)
const formatSize = (bytes: number) => `${mb(bytes)} MB`
function formatDate(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 选中文件的总字节数（批量删除时展示可释放空间）。 */
const selectedBytes = computed(() =>
  files.value.filter((f) => selected.value.includes(f.id)).reduce((sum, f) => sum + f.size, 0),
)

/** 待删除文件被哪些项目引用（去重后的标题）。 */
const pendingTitles = computed(() => {
  const titles = new Set<string>()
  for (const id of pending.value ?? []) {
    const title = refMap.value[id]
    if (title) titles.add(title)
  }
  return [...titles]
})

const allSelected = computed(() => files.value.length > 0 && selected.value.length === files.value.length)

async function loadRefMap() {
  if (props.refMap) return
  const map: Record<string, string> = {}
  const rows = await db.level2.toArray()
  for (const item of rows) {
    for (const f of item.files ?? []) {
      if (f.cloud_id) map[f.cloud_id] = item.title
    }
  }
  localRefMap.value = map
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    if (!props.refMap) await loadRefMap()
    const r = await listCloudFiles()
    files.value = r.files
    usedBytes.value = r.usedBytes
    quotaBytes.value = r.quotaBytes
    selected.value = selected.value.filter((id) => r.files.some((f) => f.id === id))
  } catch (e) {
    error.value = e instanceof Error ? e.message : '读取云端文件失败'
  } finally {
    loading.value = false
  }
}

onMounted(load)

function toggle(id: string) {
  selected.value = selected.value.includes(id)
    ? selected.value.filter((x) => x !== id)
    : [...selected.value, id]
}

function toggleAll() {
  selected.value = allSelected.value ? [] : files.value.map((f) => f.id)
}

function askDelete(ids: string[]) {
  if (!ids.length || deleting.value) return
  pending.value = ids
}

async function confirmDelete() {
  const ids = pending.value ?? []
  if (!ids.length || deleting.value) return
  deleting.value = true
  error.value = ''
  const deleted: string[] = []
  let failure = ''
  try {
    for (const id of ids) {
      try {
        await deleteCloudFile(id)
        deleted.push(id)
      } catch (e) {
        failure = e instanceof Error ? e.message : '删除失败，请重试'
      }
    }
  } finally {
    deleting.value = false
    pending.value = null
    await load()
    // 即便中途失败，也把已成功删除的部分同步给父组件
    if (deleted.length) {
      selected.value = selected.value.filter((id) => !deleted.includes(id))
      emit('changed', {
        usedBytes: usedBytes.value,
        quotaBytes: quotaBytes.value,
        deletedIds: deleted,
      })
    }
    error.value = failure
  }
}

function cancelDelete() {
  pending.value = null
}

/** 释放空间可选的手动重试（网络抖动时）。 */
function retry() {
  void load()
}
</script>

<template>
  <Teleport to="body">
    <div class="cf-mask" role="presentation" @click.self="emit('close')">
      <section class="cf" role="dialog" aria-modal="true" aria-label="云端文件管理">
        <header class="cf-head">
          <h2>云端文件</h2>
          <button type="button" class="cf-x" aria-label="关闭" @click="emit('close')">✕</button>
        </header>

        <div class="cf-summary">
          <StorageRing :used="usedBytes" :quota="quotaBytes" :size="64" :stroke="7" />
          <div class="cf-count">
            <span class="n">{{ files.length }}</span>
            <span class="lbl">个文件</span>
            <p class="hint">删除不用的旧音频 / 图片即可释放空间</p>
          </div>
        </div>

        <div class="cf-tools">
          <label class="check">
            <input type="checkbox" :checked="allSelected" :disabled="!files.length" @change="toggleAll" />
            <span>全选</span>
          </label>
          <span v-if="selected.length" class="picked">
            已选 {{ selected.length }} 个 · {{ formatSize(selectedBytes) }}
          </span>
          <button
            type="button"
            class="danger"
            :disabled="!selected.length || deleting"
            @click="askDelete(selected)"
          >
            删除所选
          </button>
        </div>

        <div class="cf-list">
          <p v-if="loading" class="state">读取中…</p>
          <template v-else-if="files.length">
            <div v-for="f in files" :key="f.id" class="cf-row" :class="{ on: selected.includes(f.id) }">
              <label class="check">
                <input type="checkbox" :checked="selected.includes(f.id)" @change="toggle(f.id)" />
                <span class="sr">选择 {{ f.name }}</span>
              </label>
              <span class="kind" :class="f.mime.startsWith('audio/') ? 'a' : 'i'">
                {{ f.mime.startsWith('audio/') ? '音频' : '图片' }}
              </span>
              <div class="meta">
                <p class="name" :title="f.name">{{ f.name }}</p>
                <p class="sub">{{ formatSize(f.size) }} · {{ formatDate(f.created_at) }}</p>
                <p v-if="refMap[f.id]" class="ref">正被《{{ refMap[f.id] }}》引用</p>
              </div>
              <button type="button" class="row-del" :disabled="deleting" @click="askDelete([f.id])">删除</button>
            </div>
          </template>
          <p v-else class="state">还没有上传过云端文件</p>
        </div>

        <p v-if="error" class="err">
          {{ error }}
          <button type="button" class="link" @click="retry">重试</button>
        </p>

        <footer class="cf-foot">
          <button type="button" class="ghost" @click="emit('close')">关闭</button>
        </footer>

        <!-- 二次确认 -->
        <div v-if="pending" class="cf-confirm" role="presentation">
          <div class="card" role="alertdialog" aria-modal="true" aria-label="确认删除">
            <h3>确认删除</h3>
            <p class="q">确定要删除选中的 {{ pending.length }} 个文件吗？</p>
            <p v-if="pendingTitles.length" class="warn">
              该文件正被项目
              <template v-for="(t, i) in pendingTitles" :key="t">
                <span class="proj">《{{ t }}》</span><span v-if="i < pendingTitles.length - 1">、</span>
              </template>
              引用，删除后对应素材将失效，确认删除？
            </p>
            <p class="note">删除后不可恢复，容量会立即释放。</p>
            <div class="acts">
              <button type="button" class="ghost" @click="cancelDelete">取消</button>
              <button type="button" class="danger solid" :disabled="deleting" @click="confirmDelete">
                {{ deleting ? '删除中…' : '确认删除' }}
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.cf-mask {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(0, 0, 0, 0.3);
  -webkit-backdrop-filter: blur(6px);
  backdrop-filter: blur(6px);
}
.cf {
  position: relative;
  display: flex;
  flex-direction: column;
  width: min(560px, 100%);
  max-height: min(84dvh, 720px);
  background: var(--glass);
  border: 1px solid var(--card-glass-border);
  -webkit-backdrop-filter: blur(30px) saturate(180%);
  backdrop-filter: blur(30px) saturate(180%);
  box-shadow: var(--card-glass-shadow);
  border-radius: var(--r-l);
  padding: 16px 16px 12px;
  overflow: hidden;
}
.cf-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.cf-head h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 500;
  color: var(--text);
}
.cf-x {
  border: none;
  background: var(--fill);
  color: var(--muted);
  width: 30px;
  height: 30px;
  border-radius: 50%;
  font-size: 13px;
  cursor: pointer;
}
.cf-summary {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 12px;
  border-radius: var(--r-m);
  background: var(--fill);
  margin-bottom: 10px;
}
.cf-count {
  text-align: right;
  min-width: 0;
}
.cf-count .n {
  font-size: 20px;
  font-weight: 600;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.cf-count .lbl {
  margin-left: 4px;
  font-size: 12px;
  color: var(--muted);
}
.cf-count .hint {
  margin: 4px 0 0;
  font-size: 11px;
  color: var(--muted);
  line-height: 1.4;
}
.cf-tools {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 2px 8px;
  border-bottom: 1px solid var(--line);
}
.check {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--muted);
  cursor: pointer;
  user-select: none;
}
.check input {
  width: 16px;
  height: 16px;
  accent-color: var(--accent);
  margin: 0;
}
.sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
.picked {
  font-size: 12px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.danger {
  margin-left: auto;
  border: none;
  background: none;
  color: #e0300e;
  font-size: 12px;
  font-family: inherit;
  padding: 6px 10px;
  border-radius: 999px;
  cursor: pointer;
}
.danger:disabled {
  color: var(--faint);
  cursor: default;
}
.danger.solid {
  background: #e0300e;
  color: #fff;
  font-size: 13px;
  padding: 9px 18px;
  margin-left: 0;
}
.danger.solid:disabled {
  opacity: 0.6;
  color: #fff;
}
.cf-list {
  flex: 1 1 auto;
  min-height: 80px;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 6px 0;
}
.cf-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 6px;
  border-radius: var(--r-s);
  border-bottom: 1px solid var(--line);
}
.cf-row:last-child {
  border-bottom: none;
}
.cf-row.on {
  background: var(--accent-soft);
}
.kind {
  flex: 0 0 auto;
  font-size: 10px;
  line-height: 1;
  padding: 4px 6px;
  border-radius: 5px;
  letter-spacing: 0.02em;
}
.kind.a {
  color: #2563eb;
  background: rgba(37, 99, 235, 0.12);
}
.kind.i {
  color: #0f9d58;
  background: rgba(15, 157, 88, 0.12);
}
.meta {
  flex: 1 1 auto;
  min-width: 0;
}
.name {
  margin: 0;
  font-size: 13px;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sub {
  margin: 2px 0 0;
  font-size: 11px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.ref {
  margin: 3px 0 0;
  font-size: 11px;
  color: #d99a00;
}
.row-del {
  flex: 0 0 auto;
  border: none;
  background: var(--fill);
  color: #e0300e;
  font-size: 12px;
  font-family: inherit;
  padding: 6px 12px;
  border-radius: 999px;
  cursor: pointer;
}
.row-del:disabled {
  opacity: 0.5;
  cursor: default;
}
.state {
  margin: 24px 0;
  text-align: center;
  font-size: 13px;
  color: var(--muted);
}
.err {
  flex: 0 0 auto;
  margin: 6px 0 0;
  font-size: 12px;
  color: #e0300e;
}
.link {
  border: none;
  background: none;
  color: var(--accent);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  padding: 0 4px;
}
.cf-foot {
  flex: 0 0 auto;
  display: flex;
  justify-content: flex-end;
  padding-top: 8px;
}
.ghost {
  border: none;
  background: var(--fill);
  color: var(--text);
  border-radius: 999px;
  font-size: 13px;
  font-family: inherit;
  padding: 9px 18px;
  cursor: pointer;
}
/* 二次确认卡片 */
.cf-confirm {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 18px;
  background: rgba(0, 0, 0, 0.28);
  -webkit-backdrop-filter: blur(3px);
  backdrop-filter: blur(3px);
  border-radius: var(--r-l);
}
.card {
  width: 100%;
  max-width: 340px;
  background: var(--card);
  color: var(--text);
  border-radius: var(--r-m);
  padding: 18px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.28);
}
.card h3 {
  margin: 0 0 10px;
  font-size: 15px;
  font-weight: 600;
}
.q {
  margin: 0 0 8px;
  font-size: 13px;
  line-height: 1.5;
}
.warn {
  margin: 0 0 8px;
  font-size: 12px;
  line-height: 1.55;
  color: #c2410c;
}
.proj {
  font-weight: 600;
}
.note {
  margin: 0;
  font-size: 11px;
  color: var(--muted);
}
.acts {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 16px;
}
</style>
