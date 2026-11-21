/**
 * OPFS（Origin Private File System）纯前端文件层。
 * 所有音频、图片都写在浏览器自己的私有文件系统里，无需上传、无后端 API。
 * 注意：OPFS 需要安全上下文（https 或 localhost）。
 */

function getRoot(): Promise<FileSystemDirectoryHandle> {
  return navigator.storage.getDirectory()
}

/** 在 OPFS 中确保某个子目录存在 */
export async function ensureDir(name: string): Promise<FileSystemDirectoryHandle> {
  const root = await getRoot()
  return root.getDirectoryHandle(name, { create: true })
}

/** 写入一个文件（覆盖同名文件） */
export async function writeFile(
  dirName: string,
  fileName: string,
  data: Blob | ArrayBuffer | string,
): Promise<void> {
  const dir = await ensureDir(dirName)
  const handle = await dir.getFileHandle(fileName, { create: true })
  const writable = await handle.createWritable()
  await writable.write(data)
  await writable.close()
}

/** 读取一个文件，返回 Blob（可直接给 <audio> / <img> 用 URL.createObjectURL） */
export async function readFile(dirName: string, fileName: string): Promise<Blob> {
  const dir = await ensureDir(dirName)
  const handle = await dir.getFileHandle(fileName)
  return handle.getFile()
}

/** 删除一个文件 */
export async function removeFile(dirName: string, fileName: string): Promise<void> {
  const dir = await ensureDir(dirName)
  await dir.removeEntry(fileName)
}

/** 列出目录下的文件名 */
export async function listFiles(dirName: string): Promise<string[]> {
  const dir = await ensureDir(dirName)
  const names: string[] = []
  for await (const [name] of dir.entries()) {
    names.push(name)
  }
  return names
}
