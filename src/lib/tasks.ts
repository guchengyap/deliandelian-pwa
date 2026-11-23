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
 * 顶部「练声温馨提醒」卡：从打卡训练列表中抽离的特殊提示组。
 * - 识别依据：组内任一二级项 config.notesCard === true（模板迁移时打的标记）；
 * - 不参与打卡、不计入总进度、不占用「一、二、三…」编号；
 * - 由页面顶部独立卡片渲染，自定义模式下仍可编辑其文本。
 */
export interface SafetyCard {
  key: string
  /** 卡片标题，如「练声温馨提醒」 */
  title: string
  /** 解析后的条目：head 为短标题，body 为第二行说明；编号由渲染层按顺序自动生成 */
  entries: { head: string; body: string }[]
}

/**
 * 解析提示卡 note（只存纯文本，编号由渲染层自动生成）：
 * - 两行式（当前格式）：「标题」下一行跟正文，交替成组；
 * - 单行式（兼容旧数据）：「标题：正文」冒号后自动拆为正文；
 * - 兼容旧手打编号：行首的 "1. "、"2、" 等序号与多余空格直接剥离，只留纯文本。
 */
function parseNoteEntries(note: string): SafetyCard['entries'] {
  const entries: SafetyCard['entries'] = []
  for (const raw of note.split(/\n+/)) {
    let line = raw.trim()
    if (!line) continue
    // 剥离旧手打编号（"1." / "1、" / "1．" 等 + 任意空白），只保留纯文本
    line = line.replace(/^\d+[、.．]\s*/, '')
    if (!line) continue
    // 是否处于「期待新标题」状态：首行，或上一组已完成正文（两行一组交替）
    const expectHead = entries.length === 0 || !!entries[entries.length - 1].body
    const ci = line.search(/[：:]/)
    if (expectHead && ci >= 0) {
      // 旧版单行「标题：正文」格式
      const head = line.slice(0, ci).trim()
      const body = line.slice(ci + 1).trim()
      if (head) entries.push({ head, body })
      continue
    }
    if (expectHead) {
      entries.push({ head: line, body: '' })
    } else {
      entries[entries.length - 1].body = line
    }
  }
  return entries
}

function isSafetyGroup(children: Level2Item[]): boolean {
  return children.some((i) => i.config?.notesCard === true)
}

/** 抽离模板中的练声温馨提醒组；无内容或无标记时返回 null。 */
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
 * - 练声温馨提醒组（notesCard 标记）不进打卡队列，由 buildSafetyCard 单独抽离；
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
    // 练声温馨提醒组：不作为训练大类，不占编号（顶部安全卡单独渲染）。
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
