/**
 * 昵称与头像。
 *
 * 微信小程序登录接口只返回 openid，不返回昵称和头像（这是微信的限制），
 * 因此登录后 session.user.name 必然为空。任何依赖它的代码都会退化成兜底文案，
 * 导致双方都显示成同一个名字。
 *
 * 正确做法：用微信官方的 <button open-type="chooseAvatar"> 和
 * <input type="nickname"> 让用户主动授权，这两个是当前推荐的方式
 * （wx.getUserProfile / wx.getUserInfo 已被微信回收，不要使用）。
 */

const DEFAULT_AVATAR = ''

/** 生成一个可辨识的默认昵称，避免所有人都叫「我」 */
function defaultNickname(session, index) {
  const base = session && session.user ? session.user.name : null
  if (base) return base
  // 没有任何昵称信息时，用「恋人A / 恋人B」这类中性称呼区分
  const suffix = index % 2 === 0 ? 'A' : 'B'
  return '恋人' + suffix
}

/** 首字母头像占位用的文字 */
function avatarText(name) {
  const s = (name || '').trim()
  if (!s) return '❤'
  return s.slice(0, 1)
}

module.exports = { DEFAULT_AVATAR, defaultNickname, avatarText }
