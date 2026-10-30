const app = getApp()
const api = require('../../utils/api.js')
const countdown = require('../../utils/countdown.js')
const duration = require('../../utils/duration.js')
const identity = require('../../utils/identity.js')
const signcache = require('../../utils/signcache.js')
const weather = require('../../utils/weather.js')
const notifier = require('../../utils/notifier.js')
const ui = require('../../utils/ui.js')
const features = require('../../utils/features.js')

// 首页重复进入的最小间隔（毫秒）。短时间内来回切页不再重复拉数据。
const REFRESH_THROTTLE = 10000


Page({
  data: {
    loading: true,
    loggedIn: false,
    coupled: false,
    myName: '',
    needsNickname: false,
    myInitial: '❤',
    partnerName: '',
    partnerNamed: false,
    partnerInitial: '❤',
    partnerAvatar: '',
    myAvatar: '',
    inviteCode: '',
    relationDays: 0,
    durHasValue: false,
    durDays: '0',
    durHours: '00',
    durMinutes: '00',
    durSeconds: '00',
    relationStartText: '',
    nextAnniversary: null,
    unreadReminders: 0,
    pendingOrders: 0,
    weather: null,
    weatherAdvice: '',
    weatherLoading: true,
    weatherError: '',
    todayText: '',
    greetingText: '',
    featureGroups: features.FEATURE_GROUPS,
    featureCount: features.FEATURE_COUNT
  },

  onLoad() {
    // 顶部问候语与今天的日期：一天只算一次，onShow 每次进来都重算会闪
    const now = new Date()
    this.setData({
      todayText: (now.getMonth() + 1) + '月' + now.getDate() + '日 周' + '日一二三四五六'[now.getDay()],
      greetingText: this.greetingOf(now.getHours())
    })
  },

  /** 按当前时段给一句问候 */
  greetingOf(hour) {
    if (hour < 6) return '夜深了'
    if (hour < 11) return '早上好'
    if (hour < 14) return '中午好'
    if (hour < 18) return '下午好'
    return '晚上好'
  },

  onShow() {
    this.refresh()
    this.startTicker()
  },

  /** 下拉刷新 */
  async onPullDownRefresh() {
    try {
      await this.refresh(true)
    } finally {
      wx.stopPullDownRefresh()
    }
  },

  onHide() {
    this.stopTicker()
  },

  onUnload() {
    this.stopTicker()
  },

  /** 每秒刷新「在一起」计时，页面隐藏时停掉以省电 */
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
    // 秒数变化时才 setData，避免每秒重渲染整个卡片
    if (s.seconds === this.data.durSeconds && s.days === this.data.durDays) return
    this.setData({
      durDays: s.days,
      durHours: s.hours,
      durMinutes: s.minutes,
      durSeconds: s.seconds,
      durHasValue: true
    })
  },

  /** 未读提醒弹窗：微信订阅消息没配好时的兜底，进来就能看到 */
  showReminders(unread) {
    if (!unread || !unread.length) return
    if (this.reminderShown) return
    this.reminderShown = true

    // 只取最近的 3 条，避免弹窗内容过长
    const list = unread.slice(0, 3).map((r) => r.body || r.title)
    const more = unread.length > 3 ? '\n等 ' + unread.length + ' 条提醒' : ''

    wx.showModal({
      title: '有你的提醒',
      content: list.join('\n') + more,
      confirmText: '知道了',
      showCancel: false,
      complete: () => {
        // 看过即已读，避免每次进来都弹
        api.markRemindersRead(app.globalData.couple.id).catch(() => {})
        this.setData({ unreadReminders: 0 })
      }
    })
  },

  goRelationSetting() {
    wx.navigateTo({ url: '/pages/mine/mine' })
  },

  /**
   * 刷新首页数据。
   *
   * ⚠️ 每次 onShow 都会重拉纪念日 / 提醒 / 订单三个请求，
   *    用户在几个页面之间来回切时会反复打同一批接口。
   *    这里加 10 秒节流：短时间内重复进入直接跳过。
   *    例外是**情侣关系变了**（刚绑定/刚解绑）——那必须立刻重拉，
   *    否则首页会显示过期状态。
   */
  async refresh(force) {
    const coupleId = (app.globalData.couple && app.globalData.couple.id) || 0
    const now = Date.now()
    if (!force && this._lastRefreshAt && now - this._lastRefreshAt < REFRESH_THROTTLE && this._lastCoupleId === coupleId) {
      return
    }
    this._lastRefreshAt = now
    this._lastCoupleId = coupleId

    // ⚠️ 天气和功能区游客也能看，先发起请求，别让首屏干等会话恢复。
    //    原来这里是「等 restoreSession 全部跑完 → 再一次性画出来」，
    //    冷启动要空着好几秒。
    this.loadWeather()

    let loggedIn = this.data.loggedIn
    if (!loggedIn) {
      // restoreSession 内部已做并发去重：onLaunch 发起的同一次恢复会被复用，
      // 不会把同一份数据拉两遍。
      const session = await app.restoreSession()
      if (!session) {
        this.setData({ loading: false, loggedIn: false })
        return
      }
      loggedIn = true
    }
    const couple = app.globalData.couple
    const coupled = app.isCoupled()

    const dur = duration.segments(couple)

    // 第一段：核心信息立即渲染，不等任何网络请求
    // 原来这里挂着 4 个 await（纪念日/提醒/订单/两个头像），
    // 全部完成才 setData，导致回到首页时页面空白一下——就是头像「闪」的原因
    this.setData({
      loading: false,
      loggedIn: loggedIn,
      coupled: coupled,
      myName: app.myName() || '',
      needsNickname: app.needsNickname(),
      myInitial: identity.avatarText(app.myName()),
      partnerName: app.partnerName(),
      partnerNamed: !!app.partnerNameOrNull(),
      partnerInitial: app.partnerInitial(),
      inviteCode: (couple && couple.user_b) ? '' : (couple && couple.invite_code) || '',
      relationDays: dur.hasValue ? Number(dur.days) : 0,
      durHasValue: dur.hasValue,
      durDays: dur.days,
      durHours: dur.hours,
      durMinutes: dur.minutes,
      durSeconds: dur.seconds,
      relationStartText: duration.startText(couple)
    })

    // 第二段：头像（缓存命中时同步取出，不会闪）异步补齐
    this.fillAvatars()

    if (!coupled) return

    // 第三段：次要数据并行拉取，互不阻塞
    // 纪念日只查一次，同时喂给「最近纪念日」和「提醒生成」，避免重复请求
    const annJob = api.listAnniversaries(couple.id)
      .then((list) => {
        const described = list
          .map((a) => {
            const d = countdown.describe(a)
            return d ? Object.assign({}, a, { _countdown: d }) : null
          })
          .filter(Boolean)
          .sort((x, y) => x._countdown.days - y._countdown.days)
        this.setData({ nextAnniversary: described[0] || null })
        return list
      })
      .catch((e) => {
        console.error('读取纪念日失败', e.message)
        return []
      })

    const jobs = [
      annJob,
      api.listReminders(couple.id).then((reminders) => {
        const unread = reminders.filter((r) => !r.is_read)
        this.setData({ unreadReminders: unread.length })
        // 应用内提醒：不依赖微信推送，进小程序就能看到
        this.showReminders(unread)
      }).catch(() => {}),
      api.listOrders(couple.id).then((orders) => {
        this.setData({ pendingOrders: orders.filter((o) => o.status === 'pending').length })
      }).catch(() => {}),
      // 到点的纪念日写入提醒表，并在应用内弹窗提示
      // 复用 annJob 的结果，不再重复查询
      annJob.then((list) => notifier.syncPendingReminders({
        coupleId: couple.id,
        anniversaries: list,
        toName: app.partnerNameOrNull() || 'TA',
        role: '情侣'
      })).catch(() => {})
    ]
    await Promise.all(jobs)
  },

  /**
   * 首页天气卡片。
   * 优先用缓存（10 分钟内）避免每次进首页都请求；
   * 定位失败不影响天气——用默认坐标兜底，卡片始终有内容。
   */
  async loadWeather() {
    const cached = wx.getStorageSync('weather_cache') || null
    if (cached && cached.data && Date.now() - cached.at < 10 * 60 * 1000) {
      this.renderWeather(cached.data)
      return
    }

    let lat = null
    let lng = null
    try {
      const loc = await new Promise((resolve, reject) => {
        wx.getLocation({
          type: 'gcj02',
          isHighAccuracy: false,
          success: resolve,
          fail: reject
        })
      })
      lat = loc.latitude
      lng = loc.longitude
    } catch (e) {
      // 定位失败：用默认坐标，天气照常显示
    }

    try {
      const data = await weather.fetchWeather({ latitude: lat, longitude: lng })
      wx.setStorageSync('weather_cache', { at: Date.now(), data: data })
      this.renderWeather(data)
    } catch (e) {
      this.setData({ weatherLoading: false, weatherError: e.message || '天气没取到' })
    }
  },

  renderWeather(data) {
    this.setData({
      weather: data,
      weatherAdvice: weather.clothing(data.temp),
      weatherLoading: false,
      weatherError: ''
    })
  },

  /** 头像补齐：先同步用缓存，未命中再异步请求 */
  async fillAvatars() {
    const myPath = (app.globalData.profile && app.globalData.profile.avatar_url) || ''
    const partnerPath = (app.globalData.partner && app.globalData.partner.avatar_url) || ''

    // 缓存命中直接同步赋值，页面切换回来时头像不会闪
    const cachedMy = signcache.get(myPath)
    const cachedPartner = signcache.get(partnerPath)
    if (cachedMy) this.setData({ myAvatar: cachedMy })
    if (cachedPartner) this.setData({ partnerAvatar: cachedPartner })

    if (myPath && !cachedMy) {
      const url = await signcache.resolve(myPath)
      if (url) this.setData({ myAvatar: url })
    }
    if (partnerPath && !cachedPartner) {
      const url = await signcache.resolve(partnerPath)
      if (url) this.setData({ partnerAvatar: url })
    }
  },

  goMine() {
    wx.navigateTo({ url: '/pages/mine/mine' })
  },

  onLogin() {
    ui.login(this, () => {
      this.setData({ loggedIn: true })
      // 登录后必须强制刷新，不能被节流挡掉
      this.refresh(true)
    })
  },

  goBind() {
    wx.navigateTo({ url: '/pages/bind/bind' })
  },

  goFeature(e) {
    const key = e.currentTarget.dataset.key
    const routes = {
      anniversary: '/pages/anniversary/anniversary',
      diary: '/pages/diary/diary',
      album: '/pages/album/album',
      location: '/pages/location/location',
      recipe: '/pages/recipe/recipe',
      schedule: '/pages/schedule/schedule',
      preference: '/pages/preference/preference',
      cycle: '/pages/cycle/cycle',
      wish: '/pages/wish/wish',
      weather: '/pages/weather/weather'
    }
    // 菜谱和天气不依赖登录，游客可直接体验（先逛后登录，审核合规）
    if (key === 'recipe' || key === 'weather') {
      wx.navigateTo({ url: routes[key] })
      return
    }
    // 其余功能依赖登录：用户主动点击使用时才提示登录
    if (!this.data.loggedIn) {
      wx.showModal({
        title: '登录后可用',
        content: '这个功能需要登录并绑定情侣后使用，现在登录吗？',
        confirmText: '去登录',
        success: (r) => { if (r.confirm) this.onLogin() }
      })
      return
    }
    if (!this.data.coupled) {
      wx.showModal({
        title: '还没有绑定情侣',
        content: '邀请 TA 绑定情侣关系后，就能解锁全部功能了',
        confirmText: '去邀请',
        success: (r) => { if (r.confirm) this.goBind() }
      })
      return
    }
    wx.navigateTo({ url: routes[key] })
  },

  onShareAppMessage() {
    return {
      title: '来情侣小屋，和我一起记录点滴',
      path: '/pages/index/index'
    }
  }
})
