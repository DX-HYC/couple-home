/**
 * 统一的轻量 UI 封装。
 *
 * 为什么要单独抽出来：
 * 重构前，11 个页面里散落着约 40 处几乎一模一样的
 * `wx.showToast({ title: e.message || 'X失败', icon: 'none' })` 和
 * 「wx.showModal + confirmColor 红色 + success 回调里再 try/catch」的删除确认框。
 * 重复带来两个问题：① 文案/配色/兜底值各写各的，不一致；② 哪天要统一改风格得改 11 个文件。
 *
 * 这里收拢到一处，所有页面共用同一套提示与确认，后续调整只动这个文件。
 */

/** 普通提示（默认无图标）。title 非字符串时也安全转成字符串。 */
function toast(title, icon) {
  wx.showToast({ title: String(title == null ? '' : title), icon: icon || 'none' })
}

/** 成功提示 */
function ok(title) {
  wx.showToast({ title: String(title == null ? '成功' : title), icon: 'success' })
}

/**
 * 错误提示：优先用 error.message（这是 api 层翻译过的用户语言），
 * 缺失时回退 fallback，再不行给一个通用兜底。
 * 替代分散在各页的 `wx.showToast({ title: e.message || 'X失败', icon: 'none' })`。
 */
function err(error, fallback) {
  const msg = (error && error.message)
    ? error.message
    : (fallback || '操作失败，请稍后重试')
  wx.showToast({ title: msg, icon: 'none' })
}

/** 单按钮信息弹窗（用于展示较长的错误/说明，比如操作未成功） */
function alert(message, title) {
  wx.showModal({
    title: title || '提示',
    content: String(message == null ? '' : message),
    showCancel: false,
    confirmText: '知道了'
  })
}

/**
 * Promise 化的确认弹窗。
 * 替代各页重复的「标题 + 内容 + 红色 confirm + success 回调里再 try/catch」结构。
 * @returns {Promise<boolean>} 点确认 resolve(true)，取消/关闭 resolve(false)
 */
function confirm(options) {
  const o = options || {}
  return new Promise((resolve) => {
    wx.showModal({
      title: o.title || '提示',
      content: o.content || '',
      confirmText: o.confirmText || '确定',
      cancelText: o.cancelText || '取消',
      // danger=true 用警示红；否则用主题粉，和按钮配色一致
      confirmColor: o.danger ? '#ff3b30' : (o.confirmColor || '#ff6b81'),
      showCancel: o.showCancel !== false,
      success: (r) => resolve(!!r.confirm)
    })
  })
}

/**
 * 登录拦截：未登录/未绑定时弹「登录后可用」，确认则触发登录并在成功后回调。
 * 用于那些一进来就想操作、但必须登录+绑定的功能（如点菜、加菜谱）。
 * 注意：仅做「未登录/未绑定」的拦截；像首页那种「未绑定去邀请」的分流逻辑是页面自己的事。
 *
 * @param {object} page Page 实例（需具 setData）
 * @param {Function} [afterLogin] 登录成功后的刷新回调（刷新数据 / 设置 loggedIn）
 * @returns {boolean} 已满足（可继续当前操作）返回 true；已弹窗拦截返回 false
 */
function requireLogin(page, afterLogin) {
  const app = getApp()
  if (app.globalData.session && app.isCoupled()) return true
  wx.showModal({
    title: '登录后可用',
    content: '这个功能需要登录并绑定情侣后使用，现在登录吗？',
    confirmText: '去登录',
    success: (r) => { if (r.confirm) login(page, afterLogin) }
  })
  return false
}

/** 通用登录流程：showLoading → 登录 → 成功后回调 → 欢迎提示；失败走错误提示 */
function login(page, afterLogin) {
  const app = getApp()
  wx.showLoading({ title: '登录中' })
  Promise.resolve(app.login())
    .then(() => {
      wx.hideLoading()
      if (typeof afterLogin === 'function') afterLogin()
      wx.showToast({ title: '欢迎你', icon: 'success' })
    })
    .catch((e) => {
      wx.hideLoading()
      err(e, '登录失败')
    })
}

module.exports = { toast, ok, err, alert, confirm, requireLogin, login }
