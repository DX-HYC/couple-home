const app = getApp()
const api = require('../../utils/api.js')
const place = require('../../utils/place.js')
const geo = require('../../utils/geo.js')
const ui = require('../../utils/ui.js')
const logger = require('../../utils/logger.js')

/** 定位失败原因 -> 用户能看懂的话 + 是否值得重试 */
function explainLocationError(raw) {
  const msg = String(raw || '')
  if (/auth|deny|denied|authorize/i.test(msg)) {
    return { text: '需要你的位置权限才能共享位置，点这里去开启', retry: false }
  }
  if (/location service|location off|not enabled|gps/i.test(msg)) {
    return { text: '手机定位服务没开，请到系统设置里打开后重试', retry: false }
  }
  if (/timeout/i.test(msg)) {
    return { text: '定位超时，可能是信号不好或室内遮挡，请到开阔处重试', retry: true }
  }
  return { text: '定位失败，请稍后重试', retry: true }
}

Page({
  data: {
    myLocation: null,
    partnerLocation: null,
    partnerName: '',
    myPlace: '',
    partnerPlace: '',
    myHasText: false,
    partnerHasText: false,
    myUpdated: '',
    partnerUpdated: '',
    distanceText: '',
    watching: false,
    lastSync: '',
    permissionHint: '',
    geoReady: false,
    myManual: false,
    failCount: 0
  },

  onLoad() {
    this.setData({ partnerName: app.partnerName() })
    this.timer = null
  },

  onShow() {
    if (!app.isCoupled()) return
    this.loadAll()
    this.startWatch()
  },

  /** 下拉刷新 */
  onPullDownRefresh() {
    if (!app.isCoupled()) {
      wx.stopPullDownRefresh()
      return
    }
    this.loadAll().finally(() => wx.stopPullDownRefresh())
  },

  onHide() {
    this.stopWatch()
  },

  onUnload() {
    this.stopWatch()
  },

  startWatch() {
    if (this.data.watching) return
    // 进入页面先取一次，随后定时刷新，兼顾耗电与实时性
    this.tick()
    this.timer = setInterval(() => this.tick(), 60000)
    this.setData({ watching: true })
  },

  stopWatch() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.setData({ watching: false })
  },

  async tick() {
    // 两件事互不阻塞：自己定位失败不应导致看不到对方位置
    await Promise.all([
      this.reportMine().catch(() => {}),
      this.loadPartner()
    ])
  },

  async loadAll() {
    await Promise.all([
      this.reportMine().catch(() => {}),
      this.loadPartner()
    ])
  },

  /** 上报我的实时位置 */
  async reportMine() {
    // 上一次是权限类失败时不要反复重试，改为等用户处理
    if (this.blockedByPermission) return

    try {
      const res = await new Promise((resolve, reject) => {
        wx.getLocation({
          type: 'gcj02',
          isHighAccuracy: true,
          highAccuracyExpireTime: 8000,
          success: resolve,
          fail: (e) => reject(new Error(e.errMsg || '定位失败'))
        })
      })
      this.blockedByPermission = false
      this.failCount = 0

      const previous = this.data.myLocation
      const prevAddress = previous ? (previous.address || '') : ''
      let address = prevAddress
      let city = previous ? (previous.city || '') : ''
      // 手动标注过的地点优先级高于自动反查：标注更准确，不要被覆盖
      const manual = !!previous && !!previous.address_manual

      if (!manual && geo.shouldRefetch(previous, res.latitude, res.longitude)) {
        const info = await geo.reverseGeocode(res.latitude, res.longitude)
        if (info) {
          address = info.poi && info.address && info.address.indexOf(info.poi) === -1
            ? info.poi + ' · ' + info.address
            : (info.address || info.poi)
          city = info.city || city
        }
      }

      const row = await api.upsertLocation(app.globalData.couple.id, {
        owner_name: (app.globalData.profile && app.globalData.profile.owner_name) || null,
        latitude: res.latitude,
        longitude: res.longitude,
        address: address,
        city: city,
        precision: res.accuracy,
        addressManual: manual
      })

      const shown = place.formatPlace(row.address, row.latitude, row.longitude)
      this.setData({
        myLocation: row,
        myPlace: shown.place,
        myHasText: shown.hasText,
        myManual: !!row.address_manual,
        geoReady: geo.isReady(),
        lastSync: this.clock(),
        permissionHint: ''
      })
      this.calcDistance()
    } catch (e) {
      const msg = e.message || ''
      console.warn('[loc] 定位失败', JSON.stringify({ message: msg }))
      const info = explainLocationError(msg)
      // 权限类失败无法靠重试解决，标记后不再反复触发定位
      if (!info.retry) this.blockedByPermission = true
      // 连续失败时保持上一次成功的位置，不要把界面清空
      this.failCount = (this.failCount || 0) + 1
      this.setData({
        permissionHint: info.text,
        // 首次失败才提示，连续失败静默重试，避免每分钟弹一次
        failCount: this.failCount
      })
    }
  },

  /** 拉起微信选点地图，取回真实的地点名称与地址 */
  annotatePlace() {
    logger.log('[loc] 打开选点地图')
    wx.chooseLocation({
      success: async (res) => {
        logger.log('[loc] 选点成功', JSON.stringify({
          name: res.name || '', address: res.address || '',
          lat: res.latitude, lng: res.longitude
        }))
        wx.showLoading({ title: '保存中', mask: true })
        try {
          const name = res.name || ''
          const address = [name, res.address].filter(Boolean).join(' · ')
          if (!address) throw new Error('这个地点没有名称，换一个试试')

          // 注意 owner_name： upsertLocation 的写入分支会带上它
          const row = await api.upsertLocation(app.globalData.couple.id, {
            owner_name: (app.globalData.profile && app.globalData.profile.owner_name) || null,
            latitude: res.latitude,
            longitude: res.longitude,
            address: address,
            city: res.address || '',
            precision: null,
            addressManual: true
          })
          logger.log('[loc] 标注已写库', JSON.stringify({ id: row && row.id, address: row && row.address }))

          // 关键：这里不能调 reportMine()——它会立刻重新 GPS 定位，
          // 把手动标注的地点覆盖成实时坐标，表现为「提示成功但没变化」
          const saved = row && row.address ? row : Object.assign({}, this.data.myLocation, {
            address: address,
            city: res.address || '',
            latitude: res.latitude,
            longitude: res.longitude
          })
          // 标记为手动标注，后续自动反查不再覆盖（DB 里也持久化了 address_manual）
          saved._manual = true
          saved.address_manual = true
          const shown = place.formatPlace(saved.address, saved.latitude, saved.longitude)
          this.setData({
            myLocation: saved,
            myPlace: shown.place,
            myManual: true,
            myHasText: shown.hasText,
            lastSync: this.clock()
          })
          this.calcDistance()
          wx.hideLoading()
          wx.showToast({ title: '已标注', icon: 'success' })
        } catch (e) {
          console.error('[loc] 标注失败', JSON.stringify({ message: e.message || String(e) }))
          wx.hideLoading()
          ui.err(e, '标注失败')
        }
      },
      fail: (e) => {
        // 原来这里是空函数：选点失败/用户取消都没有任何反馈，
        // 表现为「点了没反应」，无法判断到底哪一步失败
        const msg = (e && e.errMsg) || ''
        console.warn('[loc] 选点失败', JSON.stringify({ errMsg: msg }))
        if (/cancel/i.test(msg)) return
        ui.toast('打不开地图，请检查网络后重试')
      }
    })
  },

  /** 撤销手动标注，恢复自动识别 */
  async clearManual() {
    const ok = await ui.confirm({
      title: '恢复自动识别',
      content: '撤销手动标注后，位置名称将回到自动识别的结果',
      confirmText: '恢复'
    })
    if (!ok) return
    try {
      const loc = this.data.myLocation
      // 没有定位数据时无从「恢复」，直接重新定位即可
      if (!loc) {
        this.setData({ myManual: false })
        await this.reportMine()
        return
      }
      const session = app.globalData.session
      await api.upsertLocation(app.globalData.couple.id, {
        owner_name: (app.globalData.profile && app.globalData.profile.owner_name) || null,
        latitude: loc.latitude,
        longitude: loc.longitude,
        address: '',
        city: '',
        precision: null,
        addressManual: false
      })
      this.setData({ myManual: false })
      await this.reportMine()
    } catch (e) {
      ui.err(e, '操作失败')
    }
  },

  async loadPartner() {
    try {
      const rows = await api.listLocations(app.globalData.couple.id)
      const session = app.globalData.session
      const others = rows.filter((r) => r.owner_id !== (session && session.user.id))
      const partner = others[0] || null
      if (!partner) {
        this.setData({ partnerLocation: null, partnerPlace: '', partnerHasText: false, partnerUpdated: '' })
        return
      }
      const shown = place.formatPlace(partner.address, partner.latitude, partner.longitude)
      this.setData({
        partnerLocation: partner,
        partnerPlace: shown.place,
        partnerHasText: shown.hasText,
        partnerUpdated: place.relativeTime(partner.updated_at)
      })
      this.calcDistance()
    } catch (e) {
      // 读取失败保持原状态
    }
  },

  calcDistance() {
    const a = this.data.myLocation
    const b = this.data.partnerLocation
    if (!a || !b) {
      this.setData({ distanceText: '' })
      return
    }
    const meters = place.haversine(a.latitude, a.longitude, b.latitude, b.longitude)
    this.setData({ distanceText: place.describeDistance(meters) })
  },

  clock() {
    const d = new Date()
    const pad = (n) => (n < 10 ? '0' + n : '' + n)
    return pad(d.getHours()) + ':' + pad(d.getMinutes())
  },

  openMap(e) {
    const lat = Number(e.currentTarget.dataset.lat)
    const lng = Number(e.currentTarget.dataset.lng)
    // 用 isNaN 判断而非真值：赤道(0)与本初子午线(0)都是合法坐标
    if (isNaN(lat) || isNaN(lng)) return
    wx.openLocation({
      latitude: lat,
      longitude: lng,
      name: e.currentTarget.dataset.name || '当前位置',
      address: e.currentTarget.dataset.addr || '',
      scale: 16
    })
  },

  openSetting() {
    wx.openSetting({})
  },

  /** 提示条上的行动按钮：首次失败去开权限，之后直接重试定位 */
  onHintTap() {
    if (this.data.failCount > 1) {
      this.blockedByPermission = false
      this.setData({ failCount: 0 })
      this.reportMine()
      return
    }
    this.openSetting()
  },

  refresh() {
    wx.showLoading({ title: '定位中' })
    this.loadAll().finally(() => wx.hideLoading())
  }
})
