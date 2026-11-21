import type { PracticeFile } from '../db/db'

/** 全局单例播放器：同一时刻只有一个 HTMLMediaElement 在播放。 */
let current: HTMLAudioElement | null = null
let sessionReady = false

/** 首次用户点击时调用（绝不在页面加载后自动播放）。 */
export function activateAudioSession(active: HTMLAudioElement | null): void {
  if (sessionReady) return
  sessionReady = true
  // iOS Safari：把音频会话切到 playback，绕过静音开关与后台中断。
  try {
    const nav = navigator as Navigator & { audioSession?: { type: string } }
    if (nav.audioSession) nav.audioSession.type = 'playback'
  } catch {
    /* 不支持则忽略 */
  }
  try {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: '练声助手还没取名字 · 跟练',
        artist: '练声伴奏',
        album: '练声助手还没取名字',
      })
      navigator.mediaSession.setActionHandler('play', () => {
        void current?.play().catch(() => {})
      })
      navigator.mediaSession.setActionHandler('pause', () => {
        current?.pause()
      })
      navigator.mediaSession.setActionHandler('stop', () => {
        if (current) {
          current.pause()
          current.currentTime = 0
        }
      })
    }
  } catch {
    /* Media Session 不可用时忽略 */
  }
  void active
}

/** 切换当前文件并更新锁屏元数据；会先暂停上一个。 */
export function takeOver(el: HTMLAudioElement, file: PracticeFile): void {
  if (current && current !== el) current.pause()
  current = el
  try {
    if ('mediaSession' in navigator && 'MediaMetadata' in window) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: file.name,
        artist: '练声助手还没取名字 · 跟练',
        album: '练声伴奏',
      })
      navigator.mediaSession.playbackState = 'playing'
    }
  } catch {
    /* 忽略 */
  }
}

export function setPlaybackState(state: MediaSessionPlaybackState): void {
  try {
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = state
  } catch {
    /* 忽略 */
  }
}

export function stopAll(): void {
  if (current) {
    current.pause()
    current.currentTime = 0
    current = null
  }
  setPlaybackState('paused')
}

export function isCurrent(el: HTMLAudioElement): boolean {
  return current === el
}
