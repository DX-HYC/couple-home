const app = getApp()
const weather = require('../../utils/weather.js')

/** 缓存 10 分钟，避免频繁请求 */
const CACHE_MS = 10 * 60 * 1000

Page({
  data: {
    weather: null,
    city: '',
    advice: '',
    tipEmoji: '',
    tipMain: '',
    tipSub: '',
    updatedText: '',
    loading: true,
    errorText: ''
  },

  onLoad() {
    this.load()
  },

  onPullDownRefresh() {
    this.load(true).finally(() => wx.stopPullDownRefresh())
  },

  onShareAppMessage() {
    return { title: '看看今天的天气' }
  },

  /** force: true 时跳过缓存 */
  async load(force) {
    this.setData({ loading: true, errorText: '' })

    // 先取定位
    let coords = { latitude: null, longitude: null, city: '' }
    try {
      coords = await this.getLocation()
    } catch (e) {
      // 定位失败用缓存坐标或默认值，天气仍要展示
      coords = { latitude: null, longitude: null, city: this.data.city }
    }

    // 缓存：非强制且未过期时直接用
    const cached = wx.getStorageSync('weather_cache') || null
    if (!force && cached && Date.now() - cached.at < CACHE_MS && cached.data) {
      this.render(cached.data)
      this.setData({ loading: false })
      return
    }

    try {
      const data = await weather.fetchWeather({
        latitude: coords.latitude,
        longitude: coords.longitude,
        city: coords.city
      })
      wx.setStorageSync('weather_cache', { at: Date.now(), data: data })
      this.render(data)
    } catch (e) {
      // 有旧缓存就退而展示旧数据，并说明时间
      if (cached && cached.data) {
        this.render(cached.data, true)
      } else {
        this.setData({ errorText: e.message || '天气没取到' })
      }
    } finally {
      this.setData({ loading: false })
    }
  },

  reload() {
    this.load(true)
  },

  /** 取当前定位，失败则返回 null 让天气用默认城市 */
  getLocation() {
    return new Promise((resolve, reject) => {
      wx.getLocation({
        type: 'gcj02',
        isHighAccuracy: false,
        success: (res) => resolve({
          latitude: res.latitude,
          longitude: res.longitude,
          city: ''
        }),
        fail: () => reject(new Error('定位失败'))
      })
    })
  },

  render(data, isStale) {
    const advice = weather.clothing(data.temp)
    const tip = this.buildTip(data)

    let updatedText = ''
    if (data.updatedAt) {
      const mins = Math.floor((Date.now() - data.updatedAt) / 60000)
      if (isStale) updatedText = '刚才 ' + mins + ' 分钟前的数据'
      else if (mins < 1) updatedText = '刚刚更新'
      else updatedText = mins + ' 分钟前更新'
    }

    this.setData({
      weather: data,
      city: data.city || '',
      advice: advice,
      tipEmoji: tip.emoji,
      tipMain: tip.main,
      tipSub: tip.sub,
      updatedText: updatedText
    })
  },

  /**
   * 情侣小贴士：根据天气给出在一起能做的事。
   * 尽量具体，不说「注意天气变化」这种空话。
   */
  buildTip(w) {
    const t = w.temp
    const code = w.text

    if (/雨/.test(code)) {
      return {
        emoji: '☔',
        main: '下雨天适合窝在一起',
        sub: '一部电影、两杯热饮，听着雨声说说话'
      }
    }
    if (/雪/.test(code)) {
      return {
        emoji: '⛄',
        main: '下雪天要一起出去走走',
        sub: '踩第一脚雪，记得给 TA 拍张照'
      }
    }
    if (/雷/.test(code)) {
      return {
        emoji: '🌩',
        main: '打雷天别让 TA 一个人',
        sub: '在家待着，说说话就好了'
      }
    }
    if (t >= 30) {
      return {
        emoji: '🍦',
        main: '天热，适合吃冰的',
        sub: '一起去买冰淇淋，或者泡在空调房里'
      }
    }
    if (t >= 22) {
      return {
        emoji: '🌳',
        main: '天气舒服，适合出门',
        sub: '公园散步、骑车、或者找个地方坐坐'
      }
    }
    if (t >= 12) {
      return {
        emoji: '🧣',
        main: '有点凉，记得提醒 TA 加衣',
        sub: '披件外套再出门会更暖'
      }
    }
    return {
      emoji: '🔥',
      main: '天冷，适合贴贴取暖',
      sub: '热奶茶、火锅，或者就是抱一下'
    }
  }
})
