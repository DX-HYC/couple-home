const app = getApp()
const api = require('../../utils/api.js')
const upload = require('../../utils/upload.js')
const media = require('../../utils/media.js')
const ui = require('../../utils/ui.js')
const { cloud } = require('../../utils/cloud.js')

const DEFAULT_ALBUMS = [
  { name: '我们的日常', emoji: '🌈' },
  { name: '旅行时光', emoji: '✈️' },
  { name: '美食记录', emoji: '🍜' }
]

// 每次签多少张图。首屏签一批，滚动接近底部再续签下一批。
const SIGN_CHUNK = 24

Page({
  data: {
    albums: [],
    current: null,
    items: [],
    showAlbumForm: false,
    albumName: '',
    albumEmoji: '📁',
    emojiOptions: ['📁', '🌈', '✈️', '🍜', '🏖', '🎂', '🐱', '🌸', '⭐'],
    uploading: false,
    loading: false
  },

  onShow() {
    if (app.isCoupled()) this.loadAlbums()
  },

  /** 下拉刷新 */
  onPullDownRefresh() {
    if (!app.isCoupled()) {
      wx.stopPullDownRefresh()
      return
    }
    this.loadAlbums().finally(() => wx.stopPullDownRefresh())
  },

  onTapAlbum(e) {
    const id = e.currentTarget.dataset.id
    const album = this.data.albums.find((a) => String(a.id) === String(id))
    if (album) this.selectAlbum(album)
  },

  async loadAlbums() {
    try {
      let albums = await api.listAlbums(app.globalData.couple.id)
      if (!albums.length) {
        // 首次使用自动建好默认分类，省去手动创建的步骤
        for (const d of DEFAULT_ALBUMS) {
          try {
            await api.createAlbum(app.globalData.couple.id, d.name, d.emoji)
          } catch (e) {}
        }
        albums = await api.listAlbums(app.globalData.couple.id)
      }

      // 一次取回全部相册内容（原来逐个相册查，3 个分类就是 3 次串行请求），
      // 顺带记进缓存，切分类时零网络请求
      let allItems = []
      try {
        allItems = await api.listAllAlbumItems(app.globalData.couple.id)
      } catch (e) {}
      this.itemCache = allItems

      const grouped = new Map()
      for (const it of allItems) {
        const key = String(it.album_id)
        if (!grouped.has(key)) grouped.set(key, [])
        grouped.get(key).push(it)
      }

      const withCount = albums.map((a) =>
        Object.assign({}, a, { count: (grouped.get(String(a.id)) || []).length })
      )
      this.setData({ albums: withCount })

      if (withCount.length) {
        const keep = this.data.current
        const target = keep
          ? withCount.find((a) => String(a.id) === String(keep.id)) || withCount[0]
          : withCount[0]
        // 不 await：先让分类栏渲染出来，图片区域随后填充
        this.selectAlbum(target)
      }
    } catch (e) {
      ui.err(e, '读取失败')
    }
  },

  async selectAlbum(album) {
    if (!album) return
    this.setData({ current: album, loading: true })

    // 缓存命中直接渲染，不再请求
    if (this.itemCache) {
      const rows = this.itemCache.filter((it) => String(it.album_id) === String(album.id))
      await this.renderItems(rows)
      this.setData({ loading: false })
      return
    }
    await this.loadItems(album.id)
  },

  async loadItems(albumId) {
    try {
      const rows = await api.listAlbumItems(app.globalData.couple.id, albumId)
      await this.renderItems(rows)
    } catch (e) {
      ui.err(e, '读取失败')
    } finally {
      this.setData({ loading: false })
    }
  },

  /**
   * 渲染相册内容。
   *
   * 三层优化：
   * 1. 先立刻 setData 占位（显示骨架），不等任何网络请求
   * 2. **渐进式回填**：每批签名（6 个一批）完成就立刻上屏，
   *    不用等全部路径签完。原来是等 4 个批次全完才更新，
   *    20 张图的话用户要空等 4 个网络往返才看到第一张。
   * 3. **按需签名**：首屏只签 SIGN_CHUNK 个，滚动接近底部再续签下一批。
   *    原来是一次性把整个相册的图都签一遍——500 张照片就是 84 个网络往返，
   *    用户要等几十秒。屏幕上看不见的图根本不用急着签。
   */
  async renderItems(rows) {
    const items = rows.map((row) => Object.assign({}, row, { _url: '' }))
    this.setData({ items: items })

    // 渲染代号：切换相册后旧的异步回填必须作废，否则会串到新相册上
    this._renderToken = (this._renderToken || 0) + 1
    const token = this._renderToken
    this._renderTokenNow = token

    this._allRows = rows
    this._signedTotal = 0
    this._signing = false
    this._scrollTop = 0

    if (!rows.length) return

    await this.signNextChunk()

    // 记下内容高度，供滚动时判断「快到底了」
    this.measureContentHeight()
  },

  /** 量一次列表高度，滚动到底判断要用 */
  measureContentHeight() {
    try {
      wx.createSelectorQuery()
        .select('.grid')
        .boundingClientRect((rect) => {
          if (rect && rect.height) this._contentHeight = rect.height
        })
        .exec()
    } catch (e) {
      this._contentHeight = 0
    }
  },

  /**
   * 签下一批图片。
   * 首批只签 SIGN_CHUNK 个；之后由滚动事件触发续签。
   */
  async signNextChunk() {
    const rows = this._allRows || []
    const token = this._renderTokenNow
    const from = this._signedTotal || 0
    const to = Math.min(rows.length, from + SIGN_CHUNK)
    if (to <= from) return
    if (this._signing) return
    this._signing = true

    const slice = rows.slice(from, to)
    try {
      await media.resolveMapProgressive(
        slice.map((r) => r.file_path),
        (map, batch) => {
          if (token !== this._renderToken) return
          this.fillSigned(slice, from, map, batch)
        }
      )
      this._signedTotal = to
    } finally {
      this._signing = false
    }
  },

  /**
   * 把新签好的一批 URL 写回列表。
   * 用「索引路径」setData，只传变化的那几个字段，不整份重发 items。
   */
  fillSigned(slice, offset, map, batch) {
    const patch = {}
    slice.forEach((row, k) => {
      if (batch.indexOf(row.file_path) < 0) return
      const url = map[row.file_path]
      if (url) patch['items[' + (offset + k) + ']._url'] = url
    })
    if (Object.keys(patch).length) this.setData(patch)
  },

  /** 页面滚动：快到底部时续签下一批图片 */
  onPageScroll(e) {
    this._scrollTop = e.scrollTop
    this.maybeSignMore()
  },

  /** 滚到接近底部（还差约两屏）时续签 */
  maybeSignMore() {
    if (this._signing) return
    const rows = this._allRows || []
    if ((this._signedTotal || 0) >= rows.length) return
    let winH = 800
    try {
      winH = wx.getSystemInfoSync().windowHeight
    } catch (e) {}
    const contentH = this._contentHeight || 0
    if (!contentH) return
    if (this._scrollTop + winH < contentH - winH * 2) return
    this.signNextChunk()
  },

  /** 上传到情侣共享目录：shared/<我的 uid>/album/... */
  async uploadFile(tempPath, mediaType) {
    const session = app.globalData.session
    if (!session) throw new Error('请先登录')
    // 走签名 URL + wx.request 直传（SDK fetch 不支持二进制 body）
    return upload.uploadSharedMedia(session.user.id, tempPath, mediaType)
  },

  async uploadImages() {
    if (!this.data.current) {
      ui.toast('先选一个分类')
      return
    }
    wx.chooseMedia({
      count: 9,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: async (res) => {
        this.setData({ uploading: true })
        wx.showLoading({ title: '上传中', mask: true })
        try {
          const files = res.tempFiles || []
          const ownerName = (app.globalData.profile && app.globalData.profile.owner_name) || null

          // ⚠️ 原来这里是「逐张串行：上传 → 写库 → 下一张」。
          //    9 张图 = 18 次网络往返，用户要干等。
          //    现在：先并发上传（限流 3 路，避免打爆带宽），再一次性批量写库。
          //    9 张图从 18 个往返降到 3 个上传批次 + 1 次写库。
          const uploaded = await this.uploadInBatches(files, 'image')

          await api.createAlbumItems(app.globalData.couple.id, this.data.current.id, uploaded.map((u) => ({
            media_type: 'image',
            owner_name: ownerName,
            file_path: u.path,
            file_size: u.file.size,
            width: u.file.width,
            height: u.file.height
          })))

          wx.hideLoading()
          wx.showToast({ title: '已上传 ' + uploaded.length + ' 张', icon: 'success' })
          await this.reloadCurrent()
        } catch (e) {
          wx.hideLoading()
          ui.err(e, '上传失败')
        } finally {
          this.setData({ uploading: false })
        }
      }
    })
  },

  /**
   * 并发上传（限流），返回上传结果列表。
   * 逐个串行上传 9 张图要 9 个来回，并发 3 路只要 3 个。
   */
  async uploadInBatches(files, mediaType) {
    const CONCURRENCY = 3
    const out = []
    for (let i = 0; i < files.length; i += CONCURRENCY) {
      const batch = files.slice(i, i + CONCURRENCY)
      const results = await Promise.all(batch.map(async (f) => {
        const path = await this.uploadFile(f.tempFilePath, mediaType)
        return { path: path, file: f }
      }))
      out.push(...results)
    }
    return out
  },

  async uploadVideo() {
    if (!this.data.current) {
      ui.toast('先选一个分类')
      return
    }
    wx.chooseMedia({
      count: 1,
      mediaType: ['video'],
      sourceType: ['album', 'camera'],
      success: async (res) => {
        if (!res.tempFiles || !res.tempFiles.length) {
          this.setData({ uploading: false })
          return
        }
        const f = res.tempFiles[0]
        this.setData({ uploading: true })
        wx.showLoading({ title: '上传中', mask: true })
        try {
          const path = await this.uploadFile(f.tempFilePath, 'video')
          await api.createAlbumItem(app.globalData.couple.id, this.data.current.id, {
            media_type: 'video',
            owner_name: (app.globalData.profile && app.globalData.profile.owner_name) || null,
            file_path: path,
            file_size: f.size,
            duration: Math.round((f.duration || 0) / 1000),
            width: f.width,
            height: f.height
          })
          wx.hideLoading()
          wx.showToast({ title: '已上传', icon: 'success' })
          // refreshCounts 会顺带刷新 itemCache，之后直接读缓存渲染，不再查库
          await this.reloadCurrent()
        } catch (e) {
          wx.hideLoading()
          ui.err(e, '上传失败')
        } finally {
          this.setData({ uploading: false })
        }
      }
    })
  },

  /** 上传/删除后刷新计数与缓存：一次取回全部内容在内存里分组 */
  async refreshCounts() {
    try {
      const all = await api.listAllAlbumItems(app.globalData.couple.id)
      this.itemCache = all
      const counts = new Map()
      for (const it of all) {
        const key = String(it.album_id)
        counts.set(key, (counts.get(key) || 0) + 1)
      }
      const albums = this.data.albums.map((a) =>
        Object.assign({}, a, { count: counts.get(String(a.id)) || 0 })
      )
      this.setData({ albums: albums })
    } catch (e) {
      // 计数刷新失败不影响已渲染的内容
    }
  },

  /** 上传/删除后：刷新缓存 + 计数 + 当前相册内容（只查一次库） */
  async reloadCurrent() {
    await this.refreshCounts()
    const current = this.data.current
    if (!current) return
    const rows = (this.itemCache || []).filter(
      (it) => String(it.album_id) === String(current.id)
    )
    this.renderItems(rows)
  },

  preview(e) {
    const url = e.currentTarget.dataset.url
    const urls = this.data.items.filter((i) => i.media_type === 'image').map((i) => i._url)
    wx.previewImage({ current: url, urls: urls })
  },

  playVideo(e) {
    const url = e.currentTarget.dataset.url
    wx.previewMedia({ sources: [{ type: 'video', url: url }] })
  },

  async del(e) {
    const id = e.currentTarget.dataset.id
    const path = e.currentTarget.dataset.path
    const ok = await ui.confirm({ title: '删除', content: '删除后对方也看不到了，确定吗？', danger: true })
    if (!ok) return
    try {
      // 数据库记录属于情侣共享范围，双方均可删除；文件本体仅上传者可删
      await api.deleteAlbumItem(app.globalData.couple.id, id)
      try {
        await cloud.storage.remove([path])
      } catch (storageErr) {
        // 文件删除失败不阻断记录删除
      }
      await this.reloadCurrent()
    } catch (err) {
      ui.err(err, '删除失败')
    }
  },

  openAlbumForm() {
    this.setData({ showAlbumForm: true, albumName: '', albumEmoji: '📁' })
  },

  closeAlbumForm() { this.setData({ showAlbumForm: false }) },
  noop() {},

  onAlbumName(e) { this.setData({ albumName: e.detail.value }) },
  onAlbumEmoji(e) { this.setData({ albumEmoji: e.currentTarget.dataset.emoji }) },

  async createAlbum() {
    const name = (this.data.albumName || '').trim()
    if (!name) {
      ui.toast('给相册起个名字')
      return
    }
    try {
      await api.createAlbum(app.globalData.couple.id, name, this.data.albumEmoji)
      this.setData({ showAlbumForm: false })
      this.loadAlbums()
    } catch (e) {
      ui.err(e, '创建失败')
    }
  },

  async delAlbum(e) {
    const id = e.currentTarget.dataset.id
    const name = e.currentTarget.dataset.name
    const ok = await ui.confirm({
      title: '删除相册',
      content: '「' + name + '」及其中的照片视频都会删除，确定吗？',
      danger: true
    })
    if (!ok) return
    try {
      const rows = await api.deleteAlbum(app.globalData.couple.id, id)
      for (const row of rows) {
        try { await cloud.storage.remove([row.file_path]) } catch (e) {}
      }
      this.setData({ current: null })
      this.loadAlbums()
    } catch (err) {
      ui.err(err, '删除失败')
    }
  }
})
