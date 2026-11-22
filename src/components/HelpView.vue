<script setup lang="ts">
import { ref } from 'vue'

const emit = defineEmits<{ back: [] }>()

const tab = ref<'usage' | 'maintenance'>('usage')

/** 步骤式教程：一个 section 是一个小标题，steps 是按顺序的操作步骤，tip 是补充说明。 */
interface Step {
  text: string
  /** 子步骤或分支说明（如 iPhone / 安卓分开讲） */
  sub?: string[]
}
interface Section {
  title: string
  intro?: string
  steps: Step[]
  tip?: string
}

const usage: Section[] = [
  {
    title: '添加到主屏幕（像装 App 一样）',
    steps: [
      {
        text: 'iPhone：用 Safari 打开应用网址 → 底部「分享」→「添加到主屏幕」',
      },
      {
        text: '安卓：用 Chrome 打开网址 → 右上角 ⋮ →「添加到主屏幕 / 安装应用」',
      },
      {
        text: '电脑：直接在浏览器打开网址，可收藏到书签。',
      },
    ],
    tip: '从主屏幕图标打开：全屏显示、断网可用，比浏览器标签页更稳定。',
  },
  {
    title: '三个页面',
    steps: [
      { text: '统计：今日进度、本周、本月、全年一览。' },
      { text: '当日：今天的练习清单，点圆勾打卡，点名字直接开始练。' },
      { text: '跟练：一屏一项按顺序练。' },
    ],
  },
  {
    title: '跟练怎么用',
    steps: [
      { text: '点圆形按钮播放 / 暂停；同一时间只播一个音频。' },
      { text: '整段音频（或全部轮次）播完 → 自动打卡并跳下一项。' },
      { text: '图片点开看大图，双指缩放，看完关闭。' },
      { text: '底部「上一项 / 下一项」切换；无音频的项目用「手动打卡」标记完成。' },
    ],
    tip: '标题下方的灰色文字是要求：如「2~3 组，每组 60 秒，组间休息 45 秒」。',
  },
  {
    title: '打卡与取消',
    steps: [
      { text: '当日 / 跟练页点圆勾即打卡，再点一次取消。' },
      { text: '当日页「一键打卡」一次打满全部；下方「一键取消今日打卡」清零。' },
    ],
    tip: '登录后打卡状态与个人数据随账户云端同步；未登录仅本地试用，不写入默认模板。',
  },
  {
    title: '账号与云端',
    steps: [
      { text: '游客直接可用（默认模板只读）。' },
      { text: '设置页「登录 / 注册」后获得专属空间：打卡状态、练习记录与个人空间随账户云端同步，换设备登录即恢复。' },
      { text: '定制内容与上传素材存云端（每人 120MB）。' },
      { text: '重要数据可随时在设置页「导出 JSON 备份」离线兜底。' },
    ],
  },
  {
    title: '查看容量与清理旧文件',
    steps: [
      { text: '设置页「云端空间」卡片：圆环 + 精确用量（如 96.4 MB / 120 MB）。' },
      { text: '占比 85% 变黄、95% 变红并提示「空间即将满」。' },
      { text: '点「管理云端文件」→ 单个删除或勾选批量删除，容量立即刷新。' },
    ],
    tip: '删除被项目引用的素材前会提示《项目名》，确认后该项目改用本地素材或留空。',
  },
]

const maintenance: Section[] = [
  {
    title: '进入维护模式',
    steps: [
      { text: '设置页打开「维护模式」开关（需登录）。' },
    ],
    tip: '所有改动先进草稿，点「保存并退出维护」才生效并同步云端；点「取消」全部作废。管理员账号的修改即所有人的默认模板（不覆盖他人个人打卡）。',
  },
  {
    title: '增删与排序',
    steps: [
      { text: '加组 / 加练习：页面底部「＋ 新增一级项」、每组下方「＋ 新增二级项」。' },
      { text: '删除：项目或组右侧「删除」（删组需确认两次，组内练习一并删除）。' },
      { text: '排序：按住行首 ⠿ 上下拖动，也可拖进其他组；编号保存后自动重排。' },
    ],
  },
  {
    title: '上传音频 / 图片',
    steps: [
      { text: '找到目标练习 →「＋ 上传文件」，可一次多选（音频、图片混选）。' },
      { text: '上传后即时预览，右侧可「替换」「删除」。' },
    ],
    tip: '只支持音频和图片；空间不足时弹「空间不足」，点「去清理旧文件」就地腾容量。',
  },
  {
    title: '练习参数（config）',
    steps: [
      {
        text: '项目底部「config」框可写 JSON 参数（可选），常用写法：',
        sub: [
          '"secondsPerSet": 60 — 每组秒数',
          '"sets": {"min":2,"max":3} — 组数范围',
          '"restSeconds": 45 — 组间休息',
          '"reps": 10 — 次数（可写范围）',
          '"timer": 60 — 计时秒数',
        ],
      },
    ],
    tip: '写错格式保存时会提示，不会弄坏数据；看不懂可以不动它。',
  },
  {
    title: '恢复默认',
    steps: [
      { text: '维护模式内：「恢复预置方案」→ 确认 → 保存生效。' },
      { text: '登录用户也可在设置页「当前空间」行点「恢复默认模板」一键重置。' },
    ],
  },
  {
    title: '自己部署一份（可选）',
    steps: [
      { text: 'Fork 本仓库 → GitHub Pages 自动部署前端。' },
      { text: '后端按仓库根目录 DEPLOY_CF.md 部署到 Cloudflare（免费），填入自己的地址。' },
      { text: '换素材：音频放 public/audio、图片放 public/images（同名覆盖）。' },
    ],
  },
]
</script>

<template>
  <div class="help">
    <header class="bar">
      <button type="button" class="back" @click="emit('back')">‹ 返回</button>
      <h1>帮助与教程</h1>
    </header>

    <div class="tabs" role="tablist">
      <button
        type="button"
        role="tab"
        :aria-selected="tab === 'usage'"
        :class="{ active: tab === 'usage' }"
        @click="tab = 'usage'"
      >
        使用教程
      </button>
      <button
        type="button"
        role="tab"
        :aria-selected="tab === 'maintenance'"
        :class="{ active: tab === 'maintenance' }"
        @click="tab = 'maintenance'"
      >
        维护教程
      </button>
    </div>

    <section v-for="s in tab === 'usage' ? usage : maintenance" :key="s.title" class="sec">
      <h2>{{ s.title }}</h2>
      <p v-if="s.intro" class="intro">{{ s.intro }}</p>
      <ol class="steps">
        <li v-for="(st, i) in s.steps" :key="i">
          <p class="st-text">{{ st.text }}</p>
          <ul v-if="st.sub" class="sub">
            <li v-for="(line, j) in st.sub" :key="j">{{ line }}</li>
          </ul>
        </li>
      </ol>
      <p v-if="s.tip" class="tip">{{ s.tip }}</p>
    </section>

    <p class="end">—— 有问题先看这篇，还解决不了就导出一份备份再折腾 ——</p>
  </div>
</template>

<style scoped>
.help {
  width: 100%;
  max-width: 640px;
  margin: 0 auto;
}
.bar {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 22px;
}
.bar h1 {
  margin: 0;
  font-size: 20px;
  font-weight: 500;
}
.back {
  border: none;
  background: none;
  color: var(--accent);
  font-size: 15px;
  cursor: pointer;
  padding: 6px 0;
}
.tabs {
  display: flex;
  gap: 0;
  margin-bottom: 24px;
  background: var(--fill);
  border-radius: var(--r-s);
  padding: 3px;
}
.tabs button {
  flex: 1;
  padding: 8px 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--muted);
  font-size: 14px;
  font-family: inherit;
  cursor: pointer;
}
.tabs button.active {
  color: var(--text);
  background: var(--card);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
}
.sec {
  margin-bottom: 30px;
}
.sec h2 {
  margin: 0 0 10px;
  font-size: 15.5px;
  font-weight: 500;
  color: var(--text);
}
.intro {
  margin: 0 0 10px;
  font-size: 13px;
  line-height: 1.55;
  color: var(--muted);
}
.steps {
  margin: 0;
  padding: 0;
  list-style: none;
  counter-reset: step;
}
.steps > li {
  position: relative;
  padding: 8px 0 8px 30px;
  font-size: 13.5px;
  line-height: 1.6;
  color: var(--text);
}
.steps > li::before {
  counter-increment: step;
  content: counter(step);
  position: absolute;
  left: 0;
  top: 11px;
  width: 19px;
  height: 19px;
  border-radius: 999px;
  background: var(--accent-soft);
  border: 1px solid var(--accent);
  color: var(--accent);
  font-size: 11px;
  line-height: 17px;
  text-align: center;
}
.sub {
  margin: 6px 0 0;
  padding: 0;
  list-style: none;
}
.sub li {
  padding: 2px 0 2px 14px;
  position: relative;
  font-size: 13px;
  line-height: 1.6;
  color: var(--muted);
}
.sub li::before {
  content: '';
  position: absolute;
  left: 2px;
  top: 12px;
  width: 4px;
  height: 4px;
  border-radius: 999px;
  background: var(--accent);
}
.tip {
  margin: 10px 0 0;
  padding: 10px 12px;
  border: none;
  border-radius: var(--r-s);
  background: var(--fill);
  font-size: 13px;
  line-height: 1.55;
  color: var(--muted);
}
.tip::before {
  content: '💡 ';
}
.end {
  margin: 34px 0 10px;
  text-align: center;
  font-size: 12px;
  color: var(--muted);
  opacity: 0.7;
}
</style>
