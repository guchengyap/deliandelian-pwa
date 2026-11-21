import type { PracticeFile } from '../db/db'

export interface SequenceState {
  /** 轮次内部的下标（0 起） */
  cursor: number
  /** 当前第几轮（1 起） */
  round: number
  /** 总轮数 */
  total: number
  /** 当前应播放的文件 id */
  fileId: string
}

/**
 * 根据 config.sequence 与 files 计算轮次状态。
 * sequence 长度 ÷ files 个数 = 总轮数（向下取整，至少 1）；
 * cursor 在 sequence 上循环，超出末尾回到 0 并进入下一轮。
 */
export function resolveSequence(
  sequence: string[] | undefined,
  files: PracticeFile[],
  cursor: number,
): SequenceState | null {
  if (!sequence || sequence.length === 0 || files.length === 0) return null
  const safeCursor = ((cursor % sequence.length) + sequence.length) % sequence.length
  const perRound = files.length
  const total = Math.max(1, Math.floor(sequence.length / perRound))
  const round = Math.min(total, Math.floor(safeCursor / perRound) + 1)
  const fileId = files.find((f) => f.id === sequence[safeCursor])?.id ?? sequence[safeCursor]!
  return { cursor: safeCursor, round, total, fileId }
}
