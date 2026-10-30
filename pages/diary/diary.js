const app = getApp()
const api = require('../../utils/api.js')
const upload = require('../../utils/upload.js')
const media = require('../../utils/media.js')
const ui = require('../../utils/ui.js')

const MOODS = ['😊', '🥰', '😌', '🤩', '😢', '😡', '😴', '🤗']
const WEATHERS = ['☀️', '⛅', '☁️', '🌧', '❄️', '🌫', '🌈']

Page({
  data: {
    list: [],
    showForm: false,
    content: '',
    mood: '😊',
    weather: '☀️',
    moodOptions: MOODS,
    weatherOptions: WEATHERS,
    locationName: '',
    latitude: null,
    longitude: null,
    images: [],
    saving: false,
    inputFocus: false,
    loading: false
  },

  onShow() {
    if (app.isCoupled()) this.load()
  },

  /** 下拉刷新 */
  onPullDownRefresh() {
    if (!app.isCoupled()) {
      wx.stopPullDownRefresh()
      return
    }
    this.load(true).finally(() => wx.stopPullDownRefresh())
  },

  async load(showLoading) {
    if (showLoading) this.setData({ loading: true })
    try {
      const rows = await api.listDiaries(app.globalData.couple.id)
      const session = app.globalData.session
      const myId = session && session.user.id

      // 第一步：先把文字内容渲染出来，不等图片签名
      const list = rows.map((d) => Object.assign({}, d, {
        _images: [],
        _imagePaths: d.images ? this.safeParse(d.images) : [],
        // 显式初始化，避免 WXML 里访问 undefined
        _failed: {},
        _time: this.formatTime(d.created_at),
        _isMine: d.owner_id === myId,
        _avatarUrl: ''
      }))
      this.setData({ list: list })

      // 第二步：图片与头像异步补齐（已缓存的会立即命中）
      await this.fillMedia(list)

      this.setData({ loading: false })
    } catch (e) {
      this.setData({ loading: false })
      ui.err(e, '读取失败')
    }
  },

  /**
   * 补齐图片与头像签名。
   *
   * 原来逐条 await：N 篇日记的图片签名完全串行，等于 N 倍网络往返。
   * 现在：收集所有路径 → 一次并发签名 → 逐条 setData。
   *
   * ⚠️ 原来用的 media.resolveMany 会**过滤掉解析失败的项**，
   *    导致下标和原路径对不上——某张图签名失败时，后面的图会**串位**
   *    （显示成别的照片）。改用 resolveMapProgressive 按路径回填，
   *    既不会错位，又能做到每批签完就上屏，不用等全部签完。
   */
  async fillMedia(list) {
    // 渲染代号：列表重载后旧的异步回填必须作废，否则会写到新列表上
    this._mediaToken = (this._mediaToken || 0) + 1
    const token = this._mediaToken

    // 收集所有待签名路径
    const jobs = []
    for (let i = 0; i < list.length; i += 1) {
      const paths = list[i]._imagePaths || []
      if (paths.length) jobs.push({ kind: 'images', i, paths })
      if (list[i].avatar_url) jobs.push({ kind: 'avatar', i, path: list[i].avatar_url })
    }
    if (!jobs.length) return

    const allPaths = []
    for (const j of jobs) {
      if (j.kind === 'images') allPaths.push.apply(allPaths, j.paths)
      else allPaths.push(j.path)
    }

    // 每批（6 个）签完就回填一次，不必等全部路径都签完
    await media.resolveMapProgressive(allPaths, (map, batch) => {
      if (token !== this._mediaToken) return
      const patch = {}
      for (const j of jobs) {
        if (j.kind === 'images') {
          const urls = j.paths.map((p) => map[p] || '').filter(Boolean)
          if (urls.length) patch['list[' + j.i + ']._images'] = urls
        } else {
          const url = map[j.path] || ''
          if (url) patch['list[' + j.i + ']._avatarUrl'] = url
        }
      }
      if (Object.keys(patch).length) this.setData(patch)
    })
  },

  safeParse(text) {
    try {
      const arr = JSON.parse(text)
      return Array.isArray(arr) ? arr : []
    } catch (e) {
      return []
    }
  },

  formatTime(iso) {
    if (!iso) return ''
    const d = new Date(iso)
    const now = new Date()
    const pad = (n) => (n < 10 ? '0' + n : '' + n)
    const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
    const clock = pad(d.getHours()) + ':' + pad(d.getMinutes())
    if (sameDay) return '今天 ' + clock
    if (d.getFullYear() === now.getFullYear()) return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + clock
    return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate() + ' ' + clock
  },

  openForm() {
    this.setData({ showForm: true, content: '', locationName: '', latitude: null, longitude: null, images: [] })
  },

  closeForm() {
    this.setData({ showForm: false, inputFocus: false })
  },

  noop() {},

  onContent(e) {
    this.setData({ content: e.detail.value })
  },

  onMood(e) { this.setData({ mood: e.currentTarget.dataset.mood }) },
  onWeather(e) { this.setData({ weather: e.currentTarget.dataset.weather }) },

  /** 拉起微信选点地图，给日记标记真实地点 */
  pickLocation() {
    wx.chooseLocation({
      success: (res) => {
        // 名称 + 详细地址，TA 才看得懂具体在哪
        const text = [res.name, res.address].filter(Boolean).join(' · ')
        this.setData({
          locationName: text || '已选择位置',
          latitude: res.latitude,
          longitude: res.longitude
        })
      },
      fail: (e) => {
        // 原来这里是空函数：选点失败/用户取消都没有任何反馈，
        // 表现为「点了没反应」，无法判断到底哪一步失败
        const msg = (e && e.errMsg) || ''
        console.warn('[diary] 选点失败', JSON.stringify({ errMsg: msg }))
        if (/cancel/i.test(msg)) return
        ui.toast('打不开地图，请检查网络后重试')
      }
    })
  },

  clearLocation() {
    this.setData({ locationName: '', latitude: null, longitude: null })
  },

  chooseImages() {
    const remain = 9 - this.data.images.length
    if (remain <= 0) {
      wx.showToast({ title: '最多 9 张', icon: 'none' })
      return
    }
    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const added = res.tempFiles.map((f) => ({ path: f.tempFilePath, size: f.size }))
        this.setData({ images: this.data.images.concat(added) })
      }
    })
  },

  removeImage(e) {
    const idx = e.currentTarget.dataset.index
    const images = this.data.images.slice()
    images.splice(idx, 1)
    this.setData({ images: images })
  },

  previewImage(e) {
    const urls = this.data.images.map((i) => i.path)
    wx.previewImage({ current: e.currentTarget.dataset.src, urls: urls })
  },

  previewDiaryImage(e) {
    const urls = e.currentTarget.dataset.urls
    wx.previewImage({ current: e.currentTarget.dataset.src, urls: urls })
  },

  /** 图片加载失败：标记出来给占位，而不是无声的白块 */
  onImgError(e) {
    const dIdx = Number(e.currentTarget.dataset.diary)
    const iIdx = Number(e.currentTarget.dataset.idx)
    const list = this.data.list
    if (!list[dIdx]) return
    const failed = Object.assign({}, list[dIdx]._failed || {})
    failed[iIdx] = true
    this.setData({ ['list[' + dIdx + ']._failed']: failed })
    console.error('[diary] 图片加载失败', JSON.stringify({ diaryId: list[dIdx].id, index: iIdx }))
  },

  /** 加载失败后重新签名再试一次（签名过期等场景） */
  async retryLoad(e) {
    const dIdx = Number(e.currentTarget.dataset.diary)
    const row = this.data.list[dIdx]
    if (!row) return
    // ⚠️ 不能用 media.resolveMany：它会过滤掉解析失败的项，
    //    数组一变短，后面图片的位置就整体前移，
    //    再次失败时 onImgError 里的下标会指错图。
    //    用 resolveMap 按路径取，保留原有顺序。
    const paths = this.safeParse(row.images)
    const map = await media.resolveMap(paths)
    const fresh = paths.map((p) => map[p] || '').filter(Boolean)
    if (fresh.length) {
      this.setData({ ['list[' + dIdx + ']._images']: fresh, ['list[' + dIdx + ']._failed']: {} })
    } else {
      ui.toast('图片暂时无法加载')
    }
  },

  openMap(e) {
    const lat = Number(e.currentTarget.dataset.lat)
    const lng = Number(e.currentTarget.dataset.lng)
    // 用 isNaN 判断而非真值：赤道(0)与本初子午线(0)都是合法坐标
    if (isNaN(lat) || isNaN(lng)) return
    wx.openLocation({
      latitude: lat,
      longitude: lng,
      name: e.currentTarget.dataset.name || '日记地点',
      address: e.currentTarget.dataset.addr || '',
      scale: 16
    })
  },

  async save() {
    const content = (this.data.content || '').trim()
    if (!content && !this.data.images.length) {
      wx.showToast({ title: '写点什么或选张图片吧', icon: 'none' })
      return
    }
    this.setData({ saving: true })
    try {
      // 图片必须先传到云存储：本地临时路径只在发布者手机本次会话内有效，
      // 直接存库对方设备上根本读不到
      const session = app.globalData.session
      if (!session) throw new Error('请先登录')
      const cloudPaths = []
      for (let i = 0; i < this.data.images.length; i += 1) {
        const item = this.data.images[i]
        if (item.cloudPath) {
          cloudPaths.push(item.cloudPath)
          continue
        }
        wx.showLoading({ title: '上传图片 ' + (i + 1) + '/' + this.data.images.length, mask: true })
        // 必须放 shared/ 共享目录：users/ 私有目录对方读不到
        const path = await upload.uploadSharedImage(session.user.id, item.path, 'diary')
        cloudPaths.push(path)
      }
      wx.hideLoading()

      await api.createDiary(app.globalData.couple.id, {
        content: content || '分享了照片',
        owner_name: (app.globalData.profile && app.globalData.profile.owner_name) || null,
        avatar_url: (app.globalData.profile && app.globalData.profile.avatar_url) || null,
        images: cloudPaths.length ? JSON.stringify(cloudPaths) : null,
        mood: this.data.mood,
        weather: this.data.weather,
        location_name: this.data.locationName || null,
        latitude: this.data.latitude,
        longitude: this.data.longitude
      })
      wx.showToast({ title: '已发表', icon: 'success' })
      this.setData({ showForm: false, content: '', images: [], locationName: '', latitude: null, longitude: null })
      this.load()
    } catch (e) {
      wx.hideLoading()
      ui.err(e, '发表失败')
    } finally {
      this.setData({ saving: false })
    }
  },

  async del(e) {
    const id = e.currentTarget.dataset.id
    const ok = await ui.confirm({ title: '删除日记', content: '删除后对方也看不到了，确定吗？', danger: true })
    if (!ok) return
    try {
      await api.deleteDiary(app.globalData.couple.id, id)
      this.load()
    } catch (err) {
      ui.err(err, '删除失败')
    }
  }
})
