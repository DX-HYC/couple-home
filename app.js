const api = require('./utils/api.js')
const identity = require('./utils/identity.js')

App({
  globalData: {
    session: null,
    profile: null,
    couple: null,
    partner: null,
    ready: false
  },

  onLaunch() {
    this.restoreSession()
  },

  /** 确保自己档案上的情侣关系已同步（发起方早期版本漏同步过） */
  async syncMyProfile(couple) {
    if (!couple || !couple.user_b) return
    const profile = this.globalData.profile
    if (profile && profile.couple_id === couple.id) return
    try {
      const updated = await api.syncProfiles(couple)
      if (updated) this.globalData.profile = updated
    } catch (e) {
      // 同步失败不影响使用，下次进入会重试
    }
  },

  /**
   * 恢复登录态：已有会话则加载档案与情侣关系。
   *
   * ⚠️ 冷启动时 onLaunch 和首页 refresh() 会同时触发恢复，
   *    没有这层去重就会把同一份数据拉两遍（白等一个网络往返）。
   *    这里用两个标记兜住：
   *    - _restorePromise：正在恢复中 → 复用同一个 Promise
   *    - _sessionChecked：已经确认过登录态（无论有无会话）→ 直接复用结论
   *    网络异常时**不**置 _sessionChecked，下次还能重试。
   */
  restoreSession() {
    if (this._sessionChecked) return Promise.resolve(!!this.globalData.session)
    if (this._restorePromise) return this._restorePromise
    this._restorePromise = this._doRestore().finally(() => {
      this._restorePromise = null
    })
    return this._restorePromise
  },

  /**
   * 会话恢复的实际流程。
   *
   * 原本是 6~7 次**串行**网络往返（getSession → ensureProfile →
   * getCouple → reconcileProfile 里的 getCouple → getCouple →
   * syncMyProfile → listPartners），冷启动要等好几秒才出内容。
   *
   * 现在压到 3 个往返：
   *   1) getSession
   *   2) ensureProfile ∥ getCouple（互不依赖，并行）
   *   3) reconcileProfile ∥ loadPartner（并行，且都复用已查到的数据）
   * 另：loadPartner 不再回查 couples 表，reconcileProfile 不再自己查情侣关系。
   */
  async _doRestore() {
    try {
      const session = await api.getSession()
      if (!session) {
        this.globalData.ready = true
        this._sessionChecked = true
        return false
      }
      this.globalData.session = session

      // 档案与情侣关系互不依赖，并行拉取
      const [profile, couple] = await Promise.all([
        api.ensureProfile(),
        api.getCouple()
      ])
      this.globalData.couple = couple

      // 修正档案 + 读对方资料也互不依赖，并行
      const [fresh, partner] = await Promise.all([
        api.reconcileProfile(profile, couple),
        this.loadPartner(couple)
      ])
      this.globalData.profile = fresh
      this.globalData.partner = partner

      await this.syncMyProfile(couple)
      this.globalData.ready = true
      this._sessionChecked = true
      return true
    } catch (e) {
      this.globalData.ready = true
      // 网络异常：不清 _sessionChecked，下次进入还能重试
      return false
    }
  },

  /** 微信登录 */
  async login() {
    const session = await api.wechatLogin()
    this.globalData.session = session
    // 与冷启动同一条并行链路
    const [profile, couple] = await Promise.all([
      api.ensureProfile(),
      api.getCouple()
    ])
    this.globalData.couple = couple
    const [fresh, partner] = await Promise.all([
      api.reconcileProfile(profile, couple),
      this.loadPartner(couple)
    ])
    this.globalData.profile = fresh
    this.globalData.partner = partner
    await this.syncMyProfile(couple)
    this.globalData.ready = true
    return session
  },

  async loadPartner(couple) {
    if (!couple || !couple.user_b) return null
    // couple 对象里已经有 user_a/user_b，不必再回查 couples 表
    const partners = await api.listPartnersByIds([couple.user_a, couple.user_b])
    const session = this.globalData.session
    if (!session) return null
    return partners.find((p) => p.owner_id !== session.user.id) || null
  },

  /** 已绑定情侣（双方都已就位）才算解锁全部功能 */
  isCoupled() {
    const c = this.globalData.couple
    return !!(c && c.user_a && c.user_b)
  },

  /** 我是否还没设置昵称（微信登录不返回昵称，必须用户主动填） */
  needsNickname() {
    const p = this.globalData.profile
    return !p || !p.owner_name || !String(p.owner_name).trim()
  },

  /** 我的昵称；未设置时返回 null，由调用方决定如何提示 */
  myName() {
    const p = this.globalData.profile
    const name = p && p.owner_name ? String(p.owner_name).trim() : ''
    return name || null
  },

  /** 对方的昵称；未设置时返回 null */
  partnerNameOrNull() {
    const p = this.globalData.partner
    const name = p && p.owner_name ? String(p.owner_name).trim() : ''
    return name || null
  },

  /** 对方昵称，未设置时给出「对方」而不是「我」这类歧义文案 */
  partnerName() {
    return this.partnerNameOrNull() || '对方'
  },

  /** 对方头像占位文字 */
  partnerInitial() {
    return identity.avatarText(this.partnerNameOrNull())
  }
})
