/**
 * OPFS 写入 Worker（iOS 适配）：
 * createSyncAccessHandle() 只能在 Worker 中调用，避免在主线程做同步写入。
 * 写入请求用 Promise 链串行处理，任何时刻最多打开一个同步句柄。
 */

interface WriteRequest {
  id: number
  name: string
  /** 目标目录（按子路径空间隔离）；缺省时兼容旧调用，用 files。 */
  dir?: string
  data: ArrayBuffer
}

interface WriteResult {
  id: number
  ok: boolean
  error?: string
}

const ctx = self as unknown as {
  postMessage: (message: WriteResult) => void
  onmessage: ((event: MessageEvent<WriteRequest>) => void) | null
}

/** TS 的 DOM 库尚未包含 createSyncAccessHandle，这里按浏览器实际 API 收窄。 */
interface SyncAccessHandleLike {
  truncate(size: number): void
  write(data: ArrayBuffer): number
  flush(): void
  close(): void
}
type SyncFileHandle = FileSystemFileHandle & {
  createSyncAccessHandle: () => Promise<SyncAccessHandleLike>
}

async function writeOne({ name, dir: dirName, data }: WriteRequest): Promise<void> {
  const root = await navigator.storage.getDirectory()
  const dir = await root.getDirectoryHandle(dirName || 'files', { create: true })
  const handle = (await dir.getFileHandle(name, { create: true })) as SyncFileHandle
  const access = await handle.createSyncAccessHandle()
  try {
    access.truncate(0)
    access.write(data)
    access.flush()
  } finally {
    // 立即释放句柄，防止并发打开过多导致 iOS 报错。
    access.close()
  }
}

let chain: Promise<void> = Promise.resolve()

ctx.onmessage = (event) => {
  const request = event.data
  chain = chain.then(async () => {
    try {
      await writeOne(request)
      ctx.postMessage({ id: request.id, ok: true })
    } catch (err) {
      ctx.postMessage({ id: request.id, ok: false, error: String(err) })
    }
  })
}
