import { PitchDetector } from 'pitchy'

/**
 * 实时音高检测引擎。
 *
 * 设计约束：
 * - 零 Vue 依赖：结果写入普通可变对象 `state`，渲染层用 rAF 自行读取，
 *   绝不在音频循环里触发响应式更新。
 * - 麦克风约束关闭一切浏览器"优化"（回声消除/降噪/自动增益），
 *   这三项是音高漂移的最大来源；设备不支持时回退 { audio: true }。
 * - 生命周期：start() 必须在用户手势内调用（iOS Safari 要求）；
 *   stop() 彻底释放 rAF、音轨与 AudioContext。
 */

export interface TunerState {
  /** 是否正在监听 */
  running: boolean
  /** 最近一次有效读数的音名，如 "A4"；无则空串 */
  note: string
  /** 相对最近音级的音分偏差，-50 ~ +50（已平滑） */
  cents: number
  /** 检测频率 Hz（未平滑原始值，供参考显示） */
  frequency: number
  /** 时域 RMS 音量 0 ~ 1（驱动画音量环） */
  rms: number
  /** 信号保持透明度 1 → 0（clarity 丢失后 0.5s 淡出） */
  holdAlpha: number
  /** 连续 2s 无有效音高 */
  waiting: boolean
  /** 音名变化 / 等待状态变化时的低频通知（DOM 更新用） */
  onDisplayChange: ((s: TunerState) => void) | null
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const

/** clarity 低于此值视为噪声/静音 */
const CLARITY_THRESHOLD = 0.85
/** 信号消失后保持上次读数的毫秒数 */
const HOLD_MS = 500
/** 连续无有效音高多久后进入"等待" */
const WAITING_MS = 2000
/** cents 指数平滑系数：current*0.8 + new*0.2 */
const SMOOTH_KEEP = 0.8

export class PitchEngine {
  readonly state: TunerState = {
    running: false,
    note: '',
    cents: 0,
    frequency: 0,
    rms: 0,
    holdAlpha: 0,
    waiting: false,
    onDisplayChange: null,
  }

  /** A4 参考频率，默认 440 */
  a4 = 440

  private ctx: AudioContext | null = null
  private stream: MediaStream | null = null
  private analyser: AnalyserNode | null = null
  private detector: PitchDetector<Float32Array> | null = null
  private input: Float32Array<ArrayBuffer> = new Float32Array(0)
  private rafId = 0
  private lastValidAt = 0
  /** 每帧检测到的 cents（未平滑），供平滑计算 */
  private rawCents = 0
  private hasRaw = false

  async start(): Promise<boolean> {
    if (this.state.running) return true
    // 严格约束：关闭浏览器音频"优化"，避免音高漂移。
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      })
    } catch {
      // 设备/浏览器不支持严格约束时回退，不中断应用。
      console.warn('[tuner] 严格麦克风约束不可用，回退到默认音频配置')
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      } catch (e) {
        console.warn('[tuner] 无法获取麦克风', e)
        return false
      }
    }

    const ctx = new AudioContext()
    const source = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 2048
    source.connect(analyser)

    this.ctx = ctx
    this.stream = stream
    this.analyser = analyser
    this.detector = PitchDetector.forFloat32Array(analyser.fftSize)
    this.input = new Float32Array(analyser.fftSize)

    this.state.running = true
    this.state.waiting = true
    this.state.holdAlpha = 0
    this.state.note = ''
    this.hasRaw = false
    this.lastValidAt = performance.now()
    this.notifyDisplay()
    this.loop()
    return true
  }

  stop(): void {
    if (this.rafId) cancelAnimationFrame(this.rafId)
    this.rafId = 0
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    void this.ctx?.close().catch(() => {})
    this.ctx = null
    this.analyser = null
    this.detector = null
    this.state.running = false
    this.state.waiting = false
    this.state.rms = 0
    this.state.holdAlpha = 0
    this.notifyDisplay()
  }

  /** 更新 A4 参考频率；音名换算在下一帧自动生效。 */
  setA4(hz: number): void {
    this.a4 = hz
  }

  private loop = (): void => {
    if (!this.analyser || !this.detector || !this.ctx) return
    this.rafId = requestAnimationFrame(this.loop)

    this.analyser.getFloatTimeDomainData(this.input)

    // RMS 音量（拾音指示）。
    let sum = 0
    for (let i = 0; i < this.input.length; i++) sum += this.input[i] * this.input[i]
    const rms = Math.sqrt(sum / this.input.length)
    this.state.rms = rms

    const [freq, clarity] = this.detector.findPitch(this.input, this.ctx.sampleRate)
    const now = performance.now()

    if (freq > 0 && clarity > CLARITY_THRESHOLD) {
      // 有效音高：换算最近音级与 cents。
      const midi = 69 + 12 * Math.log2(freq / this.a4)
      const nearest = Math.round(midi)
      const cents = (midi - nearest) * 100
      const name = `${NOTE_NAMES[((nearest % 12) + 12) % 12]}${Math.floor(nearest / 12) - 1}`

      this.rawCents = clamp(cents, -50, 50)
      this.hasRaw = true
      this.state.cents = this.state.cents * SMOOTH_KEEP + this.rawCents * (1 - SMOOTH_KEEP)
      this.state.frequency = freq
      this.state.holdAlpha = 1
      this.state.waiting = false
      this.lastValidAt = now

      if (name !== this.state.note) {
        this.state.note = name
        this.notifyDisplay() // 低频通知：仅音名变化时
      }
    } else {
      // 无效帧：指数平滑继续衰减但保持读数，HOLD_MS 后开始淡出。
      const sinceValid = now - this.lastValidAt
      if (this.hasRaw && sinceValid <= HOLD_MS) {
        this.state.holdAlpha = 1
      } else if (this.hasRaw) {
        // 0.25s 内从 1 淡到 0
        this.state.holdAlpha = clamp(1 - (sinceValid - HOLD_MS) / 250, 0, 1)
        if (this.state.holdAlpha === 0) {
          this.state.note = ''
          this.notifyDisplay()
        }
      } else {
        this.state.holdAlpha = 0
      }
      if (sinceValid >= WAITING_MS && !this.state.waiting) {
        this.state.waiting = true
        this.notifyDisplay()
      }
    }
  }

  private notifyDisplay(): void {
    this.state.onDisplayChange?.(this.state)
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}
