# DESIGN

## Direction contract

THESIS: 这是一个安静的每日练声工具，界面应当像 iOS 系统设置一样克制、可信、触手可及——不是展示技巧的画布。首页即统计，让坚持一目了然；最克制的中性灰绿底上只有一层毛玻璃与一个绿松石强调色。

OWN-WORLD: 冷调深灰绿渐层背景（#14181a → #1c2422），顶部有极淡的绿松石光晕；卡片是半透明白 6–10% + 22px 背景模糊 + 1px 内描边高光，圆角 18–22px；文字主色 #eef1ee、次色 #9aa8a2；强调色 #7fb69e（绿松石）。字体走系统栈，标题 500、正文 400，只用两档字重。分隔线细到 0.5px 半透明。图标为手绘 SVG 线性图标，不用 emoji。

STORY: 用户打开应用第一眼看到今天的进度与最近坚持，不需要先点进某个页面；想练时切到「当日」从目录里点任意一项，或切到「跟练」按顺序一条条走；每完成一项，勾选与进度自动更新，无需手动同步。

FIRST VIEWPORT: 首页顶部是应用名与设置图标，其下是一张今日进度卡（绿色进度条 + 4/13 之类的大数字），再往下是本周柱状图、月日历、年度热力图，全部装在同一套毛玻璃卡里。底部三个 tab：统计 / 当日 / 跟练，当前 tab 用绿松石高亮。

FORM: Operate 模式，iOS 分组列表 + 底部标签栏的组合；三页结构由用户明确指定（统计 / 当日 / 跟练），非自定义重排。seed: none (pinned)。

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
