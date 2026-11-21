import type { PracticeFile } from '../db/db'
import { cloudAvailable, cloudFileUrl } from './cloudSpace'
import { opfsDirName, SPACE } from './space'

/** 主线程侧 OPFS 文件客户端：写入走 Worker，读取走异步 getFile()。 */

interface Pending {
  resolve: () => void
  reject: (error: Error) => void
}

let worker: Worker | null = null
let seq = 0
const pending = new Map<number, Pending>()

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('../workers/opfsWriter.worker.ts', import.meta.url), {
      type: 'module',
    })
    worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; error?: string }>) => {
      const p = pending.get(e.data.id)
      if (!p) return
      pending.delete(e.data.id)
      if (e.data.ok) p.resolve()
      else p.reject(new Error(e.data.error || 'OPFS 写入失败'))
    }
    worker.onerror = () => {
      for (const p of pending.values()) p.reject(new Error('OPFS 写入 Worker 异常'))
      pending.clear()
    }
  }
  return worker
}

/** 用 id 作为文件名写入 files/ 目录；ArrayBuffer 转移所有权避免拷贝。 */
export function writeOpfsFile(name: string, data: Blob): Promise<void> {
  return data.arrayBuffer().then((buffer) => {
    const id = ++seq
    const w = getWorker()
    return new Promise<void>((resolve, reject) => {
      pending.set(id, { resolve, reject })
      w.postMessage({ id, name, dir: opfsDirName(SPACE), data: buffer }, [buffer])
    })
  })
}

async function filesDir(create = false): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory()
  return root.getDirectoryHandle(opfsDirName(SPACE), { create })
}

export async function readOpfsFile(name: string): Promise<Blob | null> {
  try {
    const dir = await filesDir()
    const handle = await dir.getFileHandle(name)
    return await handle.getFile()
  } catch {
    return null
  }
}

export async function deleteOpfsFile(name: string): Promise<void> {
  try {
    const dir = await filesDir()
    await dir.removeEntry(name)
  } catch {
    // 文件本就不存在时视为已删除
  }
}

/** 列出 OPFS files/ 下全部文件（供备份导出）；目录不存在时返回空数组。 */
export async function enumerateOpfsFiles(): Promise<{ name: string; blob: Blob }[]> {
  try {
    const dir = await filesDir()
    const out: { name: string; blob: Blob }[] = []
    for await (const [name, handle] of (dir as FileSystemDirectoryHandle & {
      entries(): AsyncIterableIterator<[string, FileSystemHandle]>
    }).entries()) {
      if (handle.kind === 'file') {
        out.push({ name, blob: await (handle as FileSystemFileHandle).getFile() })
      }
    }
    return out
  } catch {
    return []
  }
}

/** blob: URL 缓存，避免重复为同一文件创建对象 URL。 */
const urlCache = new Map<string, string>()

/**
 * 播放/预览优先级：云端 cloud_id 直链 > OPFS files/<id> > file.path（public 预置）。
 * 替换文件时保留原 id，因此新内容自动覆盖预置路径。
 */
export async function resolveFileUrl(file: PracticeFile): Promise<string> {
  // 云端文件：uuid 公开只读直链，audio/img 直接引用，浏览器自行缓存。
  if (file.cloud_id && cloudAvailable) return cloudFileUrl(file.cloud_id)
  const cached = urlCache.get(file.id)
  if (cached) return cached
  let blob = await readOpfsFile(file.id)
  if (!blob && file.path.startsWith('files/')) {
    blob = await readOpfsFile(file.path.slice('files/'.length))
  }
  const url = blob ? URL.createObjectURL(blob) : file.path
  urlCache.set(file.id, url)
  return url
}

/** 文件被替换后调用，确保下次解析拿到新内容。 */
export function invalidateFileUrl(id: string): void {
  const url = urlCache.get(id)
  if (url?.startsWith('blob:')) URL.revokeObjectURL(url)
  urlCache.delete(id)
}
