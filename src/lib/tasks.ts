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

/**
 * 顶部「练前安全提示」卡：从打卡训练列表中抽离的特殊提示组。
 * - 识别依据：组内任一二级项 config.notesCard === true（模板迁移时打的标记）；
 * - 不参与打卡、不计入总进度、不占用「一、二、三…」编号；
 * - 由页面顶部独立卡片渲染，自定义模式下仍可编辑其文本。
 */
export interface SafetyCard {
  key: string
  /** 卡片标题，如「练前安全提示」 */
  title: string
  /** 解析后的条目：no 为序号（与 head 同行加粗），head 为短标题，body 为第二行说明 */
  entries: { no: string; head: string; body: string }[]
}

/**
 * 解析提示卡 note，支持两种行格式：
 * - 两行式：「1. 标题」下一行跟正文（自定义模式里的初始格式）；
 * - 单行式（兼容旧数据）：「1. 标题：正文」冒号后自动拆为正文。
 * 无序号的行兜底为纯正文条目。
 */
function parseNoteEntries(note: string): SafetyCard['entries'] {
  const entries: SafetyCard['entries'] = []
  for (const raw of note.split(/\n+/)) {
    const line = raw.trim()
    if (!line) continue
    const m = line.match(/^(\d+)[、.．]\s*(.*)$/)
    if (m) {
      let head = m[2]!.trim()
      let body = ''
      const ci = head.search(/[：:]/)
      if (ci >= 0) {
        body = head.slice(ci + 1).trim()
        head = head.slice(0, ci).trim()
      }
      entries.push({ no: `${m[1]}.`, head, body })
    } else if (entries.length && !entries[entries.length - 1]!.body) {
      // 紧跟标题行的正文行
      entries[entries.length - 1]!.body = line
    } else {
      entries.push({ no: '', head: '', body: line })
    }
  }
  return entries
}

function isSafetyGroup(children: Level2Item[]): boolean {
  return children.some((i) => i.config?.notesCard === true)
}

/** 抽离模板中的练前安全提示组；无内容或无标记时返回 null。 */
export function buildSafetyCard(level1: Level1Item[], level2: Level2Item[]): SafetyCard | null {
  const l1 = [...level1].sort((a, b) => a.order - b.order)
  for (const first of l1) {
    const children = level2
      .filter((i) => i.level1_id === first.id && hasContent(i))
      .sort((a, b) => a.order - b.order)
    if (children.length === 0 || !isSafetyGroup(children)) continue
    const note = children
      .map((i) => i.note ?? '')
      .filter(Boolean)
      .join('\n')
    const entries = parseNoteEntries(note)
    if (!entries.length) continue
    return { key: first.id, title: first.title, entries }
  }
  return null
}

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
 * - 练前安全提示组（notesCard 标记）不进打卡队列，由 buildSafetyCard 单独抽离；
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
    // 练前安全提示组：不作为训练大类，不占编号（顶部安全卡单独渲染）。
    if (isSafetyGroup(children)) continue

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
