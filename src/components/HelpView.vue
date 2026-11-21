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
    title: '同步怎么工作',
    intro: '手机和电脑的数据会自动保持一致，不需要你操作。',
    steps: [
      {
        text: '前提只有两个：手机和电脑连的是同一个 Wi-Fi；电脑开着且同步服务在运行。同步服务已设为开机自动后台运行（无窗口）；若没装自启，在电脑上双击 sync 文件夹的 start-sync.bat 即可。',
      },
      {
        text: '手机打卡后，几秒钟内就会自动出现在电脑上，不用刷新、不用按任何按钮。',
      },
      {
        text: '不想同步了：设置页「自动同步」开关关掉即可，打卡只存本机；再打开就恢复同步。',
      },
      {
        text: '电脑没开机也没关系：打卡会先存在手机里。等下次电脑开着、再打开手机应用时，会自动补传过去。',
      },
      {
        text: '苹果手机锁屏后页面会暂停：正在等的同步会推迟到你下次打开应用时完成。打卡不会丢。',
      },
      {
        text: '想确认状态：设置页的「同步通道」一行，显示「已连接」就是电脑端在线，「等待电脑端启动」就是暂时还没连上。',
      },
    ],
  },
  {
    title: '如何导出备份',
    intro: '自定义的方案和上传的音频只保存在这台设备上，换手机或清理浏览器前一定要先导出。',
    steps: [
      { text: '打开「设置」，找到「备份与恢复」。' },
      { text: '点「导出备份」，会下载一个 zip 文件，里面是全部打卡记录、练习项目和上传的音频图片。' },
      { text: '把这个文件妥善保存（发到自己微信、存网盘都行）。' },
      { text: '换新设备时：装好应用后，点「导入备份」选中这个 zip，所有内容会自动恢复。' },
    ],
  },
]

const maintenance: Section[] = [
  {
    title: '进入维护模式',
    steps: [
      { text: '打开「设置」，点最下面的「维护模式 ›」，直接进入编辑。' },
    ],
    tip: '改动只在点「保存」后生效，误操作点「取消」即可反悔。建议定期导出备份。',
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
    tip: '只支持音频和图片，其他类型的文件会被忽略。文件保存在这台设备的本机存储里，不会占用网盘。',
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
      { text: '点「保存」：改动立即生效，跟练页马上变成新内容。' },
      { text: '点「取消」（或左上角返回）：所有改动作废，恢复到进入维护模式之前的样子，误删的内容也会回来。' },
    ],
    tip: '不确定改得对不对？大胆试，取消随时可以反悔。',
  },
  {
    title: '恢复预置方案',
    intro: '想放弃所有自定义、回到出厂的 3 组 13 项时使用。',
    steps: [
      { text: '维护模式右上角点「恢复预置方案」，再点一次「确认恢复？」。' },
      { text: '此时只是载入了预置草稿——再点「保存」才真正生效。' },
    ],
    tip: '恢复预置不会删除你上传过的音频文件，它们还留在设备里，只是不再被使用。',
  },
  {
    title: '用 zip 备份和迁移',
    steps: [
      { text: '导出：设置 → 备份与恢复 → 导出备份，得到一个 zip 文件。' },
      { text: '导入：在另一台设备装好应用后，设置 → 备份与恢复 → 导入备份，选中 zip 即可。打卡记录会自动按时间合并，练习方案和文件会整体恢复。' },
    ],
    tip: '建议每次大改方案后导出一次，存到网盘或发给自己。',
  },
  {
    title: '自己部署一份（进阶，可选）',
    intro: '想用自己的域名、自己的资源，或者给家人朋友各装一份时才需要。不感兴趣可以跳过。',
    steps: [
      {
        text: '把项目代码放到自己的 GitHub 仓库（在原仓库页面点 Fork 即可）。',
      },
      {
        text: '选一种免费托管：',
        sub: [
          'GitHub Pages：仓库 Settings → Pages → 选择分支发布',
          'Cloudflare Pages：控制台连接仓库，一键自动部署',
        ],
      },
      { text: '替换资源：把音频放进 public/audio、图片放进 public/images（同名覆盖即可）。' },
      { text: '改应用名和图标：编辑 index.html 的标题，以及图标图片（icon-192.png / icon-512.png）。' },
      {
        text: '电脑端同步：电脑装好 Node.js 后，双击项目里 sync 文件夹的 start-sync.bat，按窗口显示的网址在手机上打开。',
      },
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
