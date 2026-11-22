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
    title: '把它放进主屏幕（像装 App 一样）',
    intro: '放好之后，从桌面图标点开就能用，不需要每次输网址。',
    steps: [
      {
        text: '苹果手机（Safari 浏览器）：',
        sub: [
          '1. 用 Safari 打开电脑端窗口显示的网址',
          '2. 点屏幕底部中间的「分享」按钮（一个方框加向上箭头）',
          '3. 向下滑动列表，找到「添加到主屏幕」',
          '4. 点右上角「添加」——桌面会出现「练声助手还没取名字」图标',
        ],
      },
      {
        text: '安卓手机（Chrome 浏览器）：',
        sub: [
          '1. 用 Chrome 打开网址',
          '2. 点右上角三个点 ⋮',
          '3. 选「添加到主屏幕」或「安装应用」',
          '4. 点「添加」确认',
        ],
      },
      {
        text: '电脑：直接在浏览器打开同步服务地址即可，也可以收藏到书签。',
      },
    ],
    tip: '用「主屏幕图标」打开比在浏览器标签页里打开更稳定：全屏显示，锁屏挂起后也更容易恢复。',
  },
  {
    title: '三个页面怎么切换',
    intro: '屏幕最下面有三个按钮，点一下就换一页，当前页会变成绿色。',
    steps: [
      {
        text: '统计（第一页）：打开应用默认就是这里，一眼看到今天和最近练得怎么样。',
      },
      {
        text: '当日（第二页）：今天的完整练习目录，按小组列好。每一项的圆勾可以直接打卡，点项目名字则直接开始练这一项。',
      },
      {
        text: '跟练（第三页）：按顺序一条一条练，一屏只显示一个练习。',
      },
    ],
    tip: '想练某一项，最快的方法是去「当日」页点它的名字——会直接跳到跟练页对应位置。',
  },
  {
    title: '跟练页怎么看',
    intro: '一屏只显示一个练习，跟着音频或图片练就好。',
    steps: [
      {
        text: '编号规则：顶部灰字是分组（如「二、通道」），大标题是「编号. 项目名」。大组用一、二、三数；组里的项目用 1、2、3 数，每个组都从 1 重新开始。',
      },
      {
        text: '音频条：点圆形按钮播放，再点一次暂停。同一时间只会播一个音频——点另一个，之前那个会自动停下。',
      },
      {
        text: '自动连播与自动打卡：有的项目顶部有「第 X 轮 / 共 Y 轮」的小圆标，一首播完自动播下一首。整段音频（或全部轮次）播完后，这一项会自动打卡，不需要你点按钮。',
      },
      {
        text: '图片：点一下就能放大看大图，双指捏合可以缩放，左右滑动看下一张。看完点关闭退回。',
      },
      {
        text: '组数 / 秒数 / 次数：写在标题下方的灰色说明文字里，例如「2~3 组，每组 60 秒，组间休息 45 秒」，照着做就行。',
      },
      {
        text: '底部按钮：左右是「上一项」「下一项」；中间的「手动打卡」是备用——如果这项没有音频、或你想提前标记完成，点它即可。已经完成的项显示「已完成」，再点一次可取消。',
      },
    ],
    tip: '播完自动打卡后，回到「当日」页能看到对应项的圆勾已经变绿，统计页的数字也会同步更新。',
  },
  {
    title: '打卡统计怎么看',
    intro: '打开应用第一眼就是统计页，四个卡片从上往下看。',
    steps: [
      { text: '今日进度：今天完成了几项 / 一共有几项，带一条进度条和圆环百分比。' },
      { text: '本周：七根柱子，哪天的柱子越高，那天完成得越多。' },
      { text: '本月：日历样式，练过的日子有标记。' },
      { text: '今年：一整年的小格子图，颜色越深，那天完成得越多（类似打卡日历）。' },
    ],
  },
  {
    title: '账号与云端',
    intro: '游客可以看和练；登录后才有自己的专属定制空间。',
    steps: [
      {
        text: '游客模式：直接可用，读的是「默认空间」（公共只读）。点维护模式会提示先登录。',
      },
      {
        text: '注册 / 登录：设置页顶部「登录 / 注册」。注册填用户名、邮箱、手机号、密码（可换头像）；登录支持用户名、邮箱、手机号任意一种。',
      },
      {
        text: '新账号首次进入会自动复制一份默认模板，之后你的所有定制、上传都存在你的云端空间（每人 120MB），换设备登录即可带走。',
      },
      {
        text: '打卡记录保存在本机你的专属库里，不占云盘容量；重要节点可在设置页「导出 JSON 备份」。',
      },
    ],
  },
  {
    title: '如何导出备份',
    intro: '把打卡记录和练习方案打成一个 JSON 文件保存到手机/电脑。',
    steps: [
      { text: '打开「设置」，找到「数据备份」行，点「导出 JSON 备份」。' },
      { text: '浏览器会下载一个 .json 文件，把它妥善保存（发到自己微信、存网盘都行）。' },
    ],
    tip: '登录用户的练习内容与文件已在云端；JSON 备份主要用于保存打卡记录。',
  },
  {
    title: '查看容量与清理旧文件',
    intro: '每个账号 120 MB 云盘，满了就传不了新素材——这里的步骤教你看用量、删旧文件。',
    steps: [
      { text: '打开「设置」，看「云端空间」卡片：左边是圆环，右边是精确用量（例如 96.4 MB / 120 MB）。' },
      { text: '占比 85% 以上，圆环和文字变黄；95% 以上变红并提示「空间即将满」，用满时显示「空间已满」。' },
      { text: '点卡片右上角「管理云端文件」，可以看到所有已上传文件（名称、大小、上传时间）。' },
      { text: '删一个：点该行「删除」；删多个：先勾选，再点「删除所选」。' },
      { text: '弹出确认框后点「确认删除」，容量会立刻刷新，不用重开页面。' },
    ],
    tip: '如果文件正被某个练习项目用着，确认框会写明《项目名》并提醒删除后素材会失效；维护页顶部也有同样的容量栏和「管理云端文件」入口。',
  },
]

const maintenance: Section[] = [
  {
    title: '进入维护模式',
    steps: [
      { text: '打开「设置」，在列表里打开「维护模式」开关，直接进入编辑（需先登录）。' },
    ],
    tip: '改动在点「保存并退出维护」后生效并同步到云端；误操作点「取消」即可反悔。',
  },
  {
    title: '新增、删除、拖拽排序',
    steps: [
      { text: '加一个大组：页面最底部「＋ 新增一级项」。' },
      { text: '在组里加一个练习：每组列表下方「＋ 新增二级项」。' },
      { text: '删除一个练习：点该项目右侧的「删除」。' },
      { text: '删除整个组：点组标题旁的删除，需要连点两次确认（组里的练习会一起删掉）。' },
      { text: '排序：按住每一行左边的 ⠿ 图标上下拖动，松手即落位；也可以把一个练习直接拖进另一个组。' },
    ],
    tip: '编号不用手动改——保存之后，应用会按新的排列自动重新编好。',
  },
  {
    title: '一次上传多个音频和图片',
    steps: [
      { text: '在维护模式里找到要改的练习项目。' },
      { text: '点「＋ 上传文件」，在弹出的选择框里可以一次勾选多个文件（音频和图片混选也行）。' },
      { text: '上传完成后立刻能看到预览，每条右侧有「替换」和「删除」按钮。' },
    ],
    tip: '只支持音频和图片，其他类型的文件会被忽略。登录用户的文件保存在你的云端空间（每人 120MB）；空间放不下时会先弹「空间不足」，点「去清理旧文件」就能就地腾地方。',
  },
  {
    title: '修改练习内容与参数',
    steps: [
      { text: '标题：直接改输入框。' },
      { text: '「注释」和「练习」两个文本框：都是显示在跟练页下方的灰色说明文字，「练习」一般写动作要领、组数和秒数。' },
      {
        text: '狗喘气等项目的参数：改项目最下面的「config（可选 JSON）」框。常用写法：',
        sub: [
          '"secondsPerSet": 60 —— 每组做 60 秒',
          '"sets": { "min": 2, "max": 3 } —— 做 2 到 3 组',
          '"restSeconds": 45 —— 组间休息 45 秒',
          '"reps": 10 —— 做 10 次（也可以写成 { "min": 5, "max": 8 }）',
          '"timer": 60 —— 一个 60 秒的计时',
        ],
      },
    ],
    tip: 'config 是可选的，看不懂可以不动它。写错了格式保存时会提示，不会弄坏数据。',
  },
  {
    title: '保存和取消的区别',
    intro: '所有改动都先记在「草稿」里，正式内容在你点保存之前不会变。',
    steps: [
      { text: '点「保存并退出维护」：先完成云端同步，成功后提示「维护已完成」，改动立即生效。' },
      { text: '点「取消」（或左上角返回）：所有改动作废，恢复到进入维护模式之前的样子，误删的内容也会回来。' },
    ],
    tip: '同步失败时会提示重试并留在维护模式，数据不会丢。',
  },
  {
    title: '恢复预置方案 / 默认模板',
    intro: '想放弃所有自定义、回到出厂的 3 组 13 项时使用。',
    steps: [
      { text: '维护模式内：右上角点「恢复预置方案」，再点一次「确认恢复？」，然后「保存并退出维护」生效。' },
      { text: '登录用户也可以在设置页「当前空间」行点「恢复默认模板」，一步把专属空间重置为管理员模板。' },
    ],
  },
  {
    title: '自己部署一份（进阶，可选）',
    intro: '想用自己的域名、自己的资源，或者给家人朋友各装一份时才需要。不感兴趣可以跳过。',
    steps: [
      {
        text: '把项目代码放到自己的 GitHub 仓库（在原仓库页面点 Fork 即可），Pages 会自动部署前端。',
      },
      {
        text: '后端按仓库根目录 DEPLOY_CF.md 的步骤部署到 Cloudflare（免费），把地址填进 src/config.ts 即可拥有自己的多用户服务。',
      },
      { text: '替换资源：把音频放进 public/audio、图片放进 public/images（同名覆盖即可）。' },
      { text: '改应用名和图标：编辑 index.html 的标题，以及图标图片（icon-192.png / icon-512.png）。' },
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
