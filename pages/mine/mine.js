const app = getApp()
const api = require('../../utils/api.js')
const subscribe = require('../../utils/subscribe.js')
const identity = require('../../utils/identity.js')
const duration = require('../../utils/duration.js')
const upload = require('../../utils/upload.js')
const signcache = require('../../utils/signcache.js')
const ui = require('../../utils/ui.js')
const logger = require('../../utils/logger.js')

Page({
  data: {
    nickname: '',
    avatarUrl: '',
    avatarPath: '',
    avatarInitial: '❤',
    saving: false,
    coupled: false,
    partnerName: '',
    partnerNamed: false,
    partnerAvatar: '',
    partnerInitial: '❤',
    inviteCode: '',
    relationDays: 0,
    relationText: '',
    relationStartText: '',
    durHasValue: false,
    durText: '',
    showTimeForm: false,
    formDate: '',
    formTime: '00:00',
    templates: [],
    templatesReady: false,
    reminderCount: 0
  },

  onShow() {
    this.refresh()
    this.startTicker()
  },

  onHide() {
    this.stopTicker()
  },

  onUnload() {
    this.stopTicker()
  },

  startTicker() {
    if (this.ticker) return
    this.tickDuration()
    this.ticker = setInterval(() => this.tickDuration(), 1000)
  },

  stopTicker() {
    if (this.ticker) {
      clearInterval(this.ticker)
      this.ticker = null
    }
  },

  tickDuration() {
    const couple = app.globalData.couple
    if (!this.data.coupled || !couple) return
    const s = duration.segments(couple)
    if (!s.hasValue) return
    if (s.text === this.data.durText) return
    this.setData({ durText: s.text, durHasValue: true })
  },

  async refresh() {
    const session = app.globalData.session
    const profile = app.globalData.profile
    const couple = app.globalData.couple
    const coupled = app.isCoupled()

    const dur = duration.segments(couple)

    const rawAvatar = (profile && profile.avatar_url) || (session && session.user && session.user.avatarUrl) || ''
    const partnerRaw = (app.globalData.partner && app.globalData.partner.avatar_url) || ''

    // 第一段：文字信息立即渲染，头像不等网络（避免每次进来闪一下）
    this.setData({
      nickname: (profile && profile.owner_name) || '',
      avatarPath: rawAvatar,
      avatarInitial: identity.avatarText(profile && profile.owner_name),
      coupled: coupled,
      partnerName: app.partnerName(),
      partnerNamed: !!app.partnerNameOrNull(),
      partnerInitial: identity.avatarText(app.partnerNameOrNull()),
      inviteCode: (couple && couple.invite_code) || '',
      relationDays: dur.hasValue ? Number(dur.days) : 0,
      relationText: couple && couple.relation_date ? String(couple.relation_date).slice(0, 10) : '',
      relationStartText: duration.startText(couple),
      durHasValue: dur.hasValue,
      durText: dur.text,
      formDate: couple && couple.relation_date ? String(couple.relation_date).slice(0, 10) : '',
      formTime: couple && couple.relation_at
        ? duration.splitDateTime(String(couple.relation_at).slice(0, 16)).time
        : '00:00',
      templates: subscribe.TEMPLATES,
      templatesReady: subscribe.templatesReady()
    })

    // 第二段：头像异步补齐（缓存命中时立即返回）
    this.fillAvatars(rawAvatar, partnerRaw)

    // 第三段：订阅状态
    try {
      const subs = await api.listSubscriptions()
      this.setData({ reminderCount: subs.filter((s) => s.subscribed).length })
    } catch (e) {}
  },

  async fillAvatars(myPath, partnerPath) {
    const cachedMy = signcache.get(myPath)
    const cachedPartner = signcache.get(partnerPath)
    if (cachedMy) this.setData({ avatarUrl: cachedMy })
    if (cachedPartner) this.setData({ partnerAvatar: cachedPartner })

    if (myPath && !cachedMy) {
      const url = await signcache.resolve(myPath)
      if (url) this.setData({ avatarUrl: url })
    }
    if (partnerPath && !cachedPartner) {
      const url = await signcache.resolve(partnerPath)
      if (url) this.setData({ partnerAvatar: url })
    }
  },

  /** 微信官方头像选择（open-type="chooseAvatar"）回传临时路径 */
  onChooseAvatar(e) {
    const path = e.detail.avatarUrl
    if (!path) return
    this.setData({ tempAvatar: path })
    this.uploadAvatar(path)
  },

  /** 相册/相机兜底：微信头像选择器不可用时仍可上传 */
  chooseAvatar() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        if (!res.tempFiles || !res.tempFiles.length) return
        const path = res.tempFiles[0].tempFilePath
        this.setData({ tempAvatar: path })
        this.uploadAvatar(path)
      }
    })
  },

  async uploadAvatar(path) {
    wx.showLoading({ title: '上传中', mask: true })
    logger.log('[avatar] 开始上传', JSON.stringify({ path: path }))
    try {
      const session = app.globalData.session
      if (!session) throw new Error('请先登录')
      // 先确认文件确实读得到（iOS 上 chooseAvatar 的临时路径可能读不出二进制）
      const fs = wx.getFileSystemManager()
      let readable = true
      try {
        const st = fs.statSync(path)
        if (!st || st.size === 0) readable = false
      } catch (e) {
        readable = false
      }
      if (!readable) {
        throw new Error('头像文件读取失败，请从相册重新选择')
      }

      const cloudPath = await upload.uploadSharedImage(session.user.id, path, 'avatar')
      logger.log('[avatar] 上传成功', JSON.stringify({ cloudPath: cloudPath }))
      const updated = await api.updateProfile({ avatar_url: cloudPath })
      if (!updated) throw new Error('保存失败，请重试')
      app.globalData.profile = updated
      // 新路径的签名要现取；旧的失效签名从缓存剔除，避免下次进来显示旧图
      signcache.clear()
      const freshUrl = await signcache.resolve(cloudPath)
      this.setData({
        avatarUrl: freshUrl,
        avatarPath: cloudPath
      })
      wx.hideLoading()
      wx.showToast({ title: '头像已更新', icon: 'success' })
    } catch (e) {
      wx.hideLoading()
      console.error('[avatar] 上传失败', JSON.stringify({ message: e.message || String(e) }))
      ui.err(e, '上传失败')
    }
  },

  /* ---------- 在一起的时间 ---------- */

  openTimeForm() {
    const couple = app.globalData.couple
    const split = duration.splitDateTime(
      couple && couple.relation_at ? String(couple.relation_at).slice(0, 16) : ''
    )
    this.setData({
      showTimeForm: true,
      formDate: split.date || (couple && couple.relation_date ? String(couple.relation_date).slice(0, 10) : ''),
      formTime: split.date ? split.time : '00:00'
    })
  },

  closeTimeForm() {
    this.setData({ showTimeForm: false })
  },

  noop() {},

  onFormDate(e) {
    this.setData({ formDate: e.detail.value })
  },

  onFormTime(e) {
    this.setData({ formTime: e.detail.value })
  },

  async saveRelationTime() {
    const date = (this.data.formDate || '').trim()
    if (!date) {
      wx.showToast({ title: '请选择日期', icon: 'none' })
      return
    }
    this.setData({ saving: true })
    try {
      const updated = await api.updateRelationTime(date, this.data.formTime)
      app.globalData.couple = updated || app.globalData.couple
      this.setData({ showTimeForm: false })
      await this.refresh()
      this.tickDuration()
      wx.showToast({ title: '已保存', icon: 'success' })
    } catch (e) {
      ui.err(e, '保存失败')
    } finally {
      this.setData({ saving: false })
    }
  },

  async clearRelationTime() {
    const ok = await ui.confirm({ title: '清除在一起的时间', content: '清除后首页不再显示计时，确定吗？', danger: true })
    if (!ok) return
    try {
      const updated = await api.updateRelationTime('', '')
      app.globalData.couple = updated || app.globalData.couple
      this.setData({ showTimeForm: false, durHasValue: false, durText: '' })
      this.refresh()
    } catch (e) {
      ui.err(e, '清除失败')
    }
  },

  /** 直接用微信 nickname 输入框改完即保存，无需再点保存 */
  async onNicknameBlur(e) {
    const name = (e.detail.value || '').trim()
    if (!name) return
    const current = (app.globalData.profile && app.globalData.profile.owner_name) || ''
    if (name === current) return
    try {
      const updated = await api.updateProfile({ owner_name: name })
      app.globalData.profile = updated || app.globalData.profile
      this.setData({ nickname: name, avatarInitial: identity.avatarText(name) })
      wx.showToast({ title: '昵称已更新', icon: 'success' })
    } catch (err) {
      ui.err(err, '保存失败')
    }
  },

  goBind() {
    wx.navigateTo({ url: '/pages/bind/bind' })
  },

  copyInvite() {
    if (!this.data.inviteCode) return
    wx.setClipboardData({ data: this.data.inviteCode })
  },

  /** 统一拉起订阅授权 */
  onSubscribe() {
    subscribe.requestSubscribe(['anniversary', 'order'], app.globalData.couple.id).then((res) => {
      if (res.reason === 'not-configured') {
        wx.showModal({
          title: '订阅消息模板还没配置',
          content: '需要先在微信公众平台申请模板：\n\n1. mp.weixin.qq.com → 功能 → 订阅消息\n2. 在公共模板库挑「纪念日提醒」「点餐通知」\n3. 把 tpl_ 开头的 ID 填进 utils/subscribe.config.js\n\n项目内的 docs/订阅消息配置指南.md 有详细图文步骤。',
          showCancel: false,
          confirmText: '知道了'
        })
        return
      }
      if (res.granted) {
        wx.showModal({
          title: '订阅成功',
          content: '微信的「一次性订阅」规则：本次授权可以收到 ' + (res.count || 1) + ' 条消息。\n\n' +
            '每在纪念日、点菜时授权一次就攒一条额度，不会自动补充。',
          showCancel: false
        })
        this.refresh()
      } else {
        wx.showToast({ title: '未授权订阅', icon: 'none' })
      }
    })
  },

  async unbind() {
    const ok = await ui.confirm({
      title: '解除情侣关系',
      content: '解除后双方都无法再查看对方的数据，纪念日、日记和相册都会停止共享。此操作不可撤销。',
      danger: true
    })
    if (!ok) return
    try {
      await api.unbind()
      app.globalData.couple = null
      app.globalData.partner = null
      // 解除后旧签名链接不应再被使用
      signcache.clear()
      const fresh = await api.ensureProfile()
      if (fresh) app.globalData.profile = fresh
      wx.showToast({ title: '已解除', icon: 'success' })
      this.setData({ coupled: false })
      this.refresh()
    } catch (e) {
      ui.err(e, '解除失败')
    }
  }
})
