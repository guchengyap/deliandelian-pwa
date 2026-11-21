export interface StorageStatus {
  supported: boolean
  /** 是否已获得持久化存储许可 */
  persisted: boolean
  error?: string
}

/** 启动时申请持久化存储；结果供设置页展示。 */
export async function requestPersistence(): Promise<StorageStatus> {
  const storage = navigator.storage
  if (!storage || typeof storage.persist !== 'function') {
    return { supported: false, persisted: false }
  }
  try {
    const persisted = await storage.persist()
    return { supported: true, persisted }
  } catch (e) {
    return { supported: true, persisted: false, error: String(e) }
  }
}
