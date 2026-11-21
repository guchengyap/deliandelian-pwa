import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import { normalizeSpaceUrl, setupPwaManifest } from './lib/pwaSetup'
import { loadTheme } from './lib/theme'

normalizeSpaceUrl()
void setupPwaManifest()

createApp(App).mount('#app')

// 恢复用户主题（异步，不阻塞首屏；默认冰蓝）
void loadTheme()

/**
 * 新版 Service Worker 接管时自动刷新一次页面：
 * autoUpdate 模式下旧页面仍跑旧缓存资源，不刷新的话用户永远在用旧版
 * （表现为"改了的功能没生效/按钮行为不对"）。sessionStorage 保证一次会话只刷一次，
 * 避免循环刷新。
 */
if ('serviceWorker' in navigator) {
  let swRefreshed = sessionStorage.getItem('sw-refreshed') === '1'
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (swRefreshed) return
    swRefreshed = true
    sessionStorage.setItem('sw-refreshed', '1')
    location.reload()
  })
  // 已打开期间发现等待中的新 SW（如手机长时间驻留后台），也主动接管
  void navigator.serviceWorker.getRegistration().then((reg) => {
    if (reg?.waiting && !swRefreshed) {
      reg.waiting.postMessage('SKIP_WAITING')
    }
  })
}
