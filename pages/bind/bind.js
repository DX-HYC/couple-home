const app = getApp()
const api = require('../../utils/api.js')
const countdown = require('../../utils/countdown.js')
const ui = require('../../utils/ui.js')

Page({
  data: {
    tab: 'create',
    inviteCode: '',
    inputCode: '',
    relationDate: '',
    relationTime: '00:00',
    todayText: '',
    loading: false
  },

  onLoad() {
    const t = countdown.today()
    this.setData({
      todayText: t.getFullYear() + '年' + (t.getMonth() + 1) + '月' + t.getDate() + '日'
    })
    const couple = app.globalData.couple
    if (couple && !couple.user_b && couple.invite_code) {
      this.setData({ inviteCode: couple.invite_code })
    }
  },

  onUnload() {
    // 用户在延迟返回前手动离开时，别再触发一次 navigateBack
    if (this.navTimer) {
      clearTimeout(this.navTimer)
      this.navTimer = null
    }
  },

  switchTab(e) {
    this.setData({ tab: e.currentTarget.dataset.tab })
  },

  onInputCode(e) {
    this.setData({ inputCode: e.detail.value.toUpperCase().trim() })
  },

  onDateChange(e) {
    this.setData({ relationDate: e.detail.value })
  },

  onTimeChange(e) {
    this.setData({ relationTime: e.detail.value })
  },

  async generateInvite() {
    this.setData({ loading: true })
    try {
      const couple = await api.createInvite(this.data.relationDate || null, this.data.relationTime)
      if (couple && couple.invite_code) {
        this.setData({ inviteCode: couple.invite_code })
        app.globalData.couple = couple
        wx.showToast({ title: '邀请码已生成', icon: 'success' })
      }
    } catch (e) {
      this.showError(e)
    } finally {
      this.setData({ loading: false })
    }
  },

  /** 错误信息可能较长，用弹窗完整展示，便于定位问题 */
  showError(e) {
    const msg = (e && e.message) || '操作失败，请重试'
    console.error('[couple] bind error', JSON.stringify({ message: msg }))
    ui.alert(msg, '操作未成功')
  },

  copyInvite() {
    if (!this.data.inviteCode) return
    wx.setClipboardData({ data: this.data.inviteCode })
  },

  async bindPartner() {
    const code = this.data.inputCode
    if (!code) {
      wx.showToast({ title: '请输入对方的邀请码', icon: 'none' })
      return
    }
    this.setData({ loading: true })
    try {
      const couple = await api.acceptInvite(code)
      app.globalData.couple = couple
      // syncProfiles 与 loadPartner 无依赖关系，并行执行省一次往返
      const [profile, partner] = await Promise.all([
        api.syncProfiles(couple),
        app.loadPartner(couple)
      ])
      if (profile) app.globalData.profile = profile
      app.globalData.partner = partner
      wx.showToast({ title: '绑定成功', icon: 'success' })
      // 延迟返回要给 toast 留出显示时间；保存句柄以便页面提前离开时取消
      this.navTimer = setTimeout(() => {
        this.navTimer = null
        wx.navigateBack()
      }, 900)
    } catch (e) {
      this.showError(e)
    } finally {
      this.setData({ loading: false })
    }
  },

  copyInputCode() {
    wx.setClipboardData({ data: this.data.inputCode })
  },

  onShareAppMessage() {
    const code = this.data.inviteCode
    return {
      title: '我在情侣小屋等你，输入邀请码 ' + code + ' 就能绑定啦',
      path: '/pages/bind/bind?code=' + code
    }
  }
})
