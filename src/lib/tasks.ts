import type { Level1Item, Level2Item } from '../db/db'
import { toArabicNumber, toChineseNumber } from './numbering'

/** 一级分组：可见二级项挂在其下，编号按可见项连续生成。 */
export interface TaskGroup {
  key: string
  /** 一级中文序号，如「一」 */
  cn: string
  title: string
  tasks: PracticeTask[]
}

/** 二级任务：编号按当前可见顺序生成，不来自数据库字段。 */
export interface PracticeTask {
  key: string
  /** 二级阿拉伯序号，如「1」 */
  no: string
  item: Level2Item
}

/**
 * 一级标题已自带中文序号前缀（如「零、注意事项…」）时：
 * 不再自动编号、不占用「一、二、三…」序号，标题原样展示。
 * 用于前置型板块（注意事项）让正式训练从「一、」顺延。
 */
const PRE_NUMBERED = /^[零一二三四五六七八九十]+、/

function hasContent(item: Level2Item): boolean {
  const filesOk = Array.isArray(item.files) && item.files.length > 0
  const noteOk = typeof item.note === 'string' && item.note.length > 0
  const planOk = typeof item.plan === 'string' && item.plan.length > 0
  const configOk = item.config != null && Object.keys(item.config).length > 0
  return filesOk || noteOk || planOk || configOk
}

/**
 * 按一级 → 二级顺序构建跟练队列。
 * - 二级项 files/note/plan/config 全空则隐藏；
 * - 一级项下无可见二级则整组隐藏，且不占用一级编号；
 * - 编号只按可见项连续生成（一级中文、二级阿拉伯，二级在每组内重新起算）。
 */
export function buildTaskGroups(level1: Level1Item[], level2: Level2Item[]): TaskGroup[] {
  const groups: TaskGroup[] = []
  let groupIndex = 0
  const l1 = [...level1].sort((a, b) => a.order - b.order)

  for (const first of l1) {
    const children = level2
      .filter((i) => i.level1_id === first.id && hasContent(i))
      .sort((a, b) => a.order - b.order)
    if (children.length === 0) continue

    const preNumbered = PRE_NUMBERED.test(first.title)
    if (!preNumbered) groupIndex += 1
    groups.push({
      key: first.id,
      cn: preNumbered ? '' : toChineseNumber(groupIndex),
      title: first.title,
      tasks: children.map((item, idx) => ({
        key: item.id,
        no: toArabicNumber(idx + 1),
        item,
      })),
    })
  }
  return groups
}

/** 摊平为一屏单任务用的线性队列。 */
export function flattenTasks(groups: TaskGroup[]): PracticeTask[] {
  return groups.flatMap((g) => g.tasks)
}
