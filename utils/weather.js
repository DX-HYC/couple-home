/**
 * 实时天气。
 *
 * 为什么用 Open-Meteo：
 * - 完全免费，**不需要 API key**（和风天气、彩云天气都要注册拿 key）
 * - 无需在小程序后台配 request 合法域名以外的任何东西
 * - 数据源是各国气象局的公开预报，质量足够日常使用
 *
 * 只用当前天气 + 今天概览，不做 7 天预报（省流量也避免界面过载）。
 * 定位失败时用「当前城市」或默认坐标兜底，保证页面总有内容。
 */

const BASE = 'https://api.open-meteo.com/v1/forecast'

/** 天气代码 → 文案 + 图标（WMO 标准编码） */
const CODES = {
  0: { text: '晴', icon: '☀️' },
  1: { text: '大致晴朗', icon: '🌤' },
  2: { text: '局部多云', icon: '⛅' },
  3: { text: '阴', icon: '☁️' },
  45: { text: '雾', icon: '🌫' },
  48: { text: '雾凇', icon: '🌫' },
  51: { text: '毛毛雨', icon: '🌦' },
  53: { text: '毛毛雨', icon: '🌦' },
  55: { text: '浓毛毛雨', icon: '🌧' },
  56: { text: '冻雨', icon: '🌧' },
  57: { text: '冻雨', icon: '🌧' },
  61: { text: '小雨', icon: '🌦' },
  63: { text: '中雨', icon: '🌧' },
  65: { text: '大雨', icon: '🌧' },
  66: { text: '冻雨', icon: '🌧' },
  67: { text: '冻雨', icon: '🌧' },
  71: { text: '小雪', icon: '🌨' },
  73: { text: '中雪', icon: '🌨' },
  75: { text: '大雪', icon: '❄️' },
  77: { text: '雪粒', icon: '🌨' },
  80: { text: '阵雨', icon: '🌦' },
  81: { text: '强阵雨', icon: '🌧' },
  82: { text: '暴雨', icon: '⛈' },
  85: { text: '阵雪', icon: '🌨' },
  86: { text: '强阵雪', icon: '❄️' },
  95: { text: '雷雨', icon: '⛈' },
  96: { text: '雷雨伴冰雹', icon: '⛈' },
  99: { text: '雷雨伴冰雹', icon: '⛈' }
}

function describe(code) {
  const c = CODES[code]
  return c || { text: '未知', icon: '🌡' }
}

/** 风力等级（ Beaufort ） */
function windLevel(kmh) {
  const v = Number(kmh)
  if (isNaN(v)) return ''
  if (v < 1) return '0 级'
  if (v < 6) return '1 级'
  if (v < 12) return '2 级'
  if (v < 20) return '3 级'
  if (v < 29) return '4 级'
  if (v < 39) return '5 级'
  if (v < 50) return '6 级'
  if (v < 62) return '7 级'
  if (v < 75) return '8 级'
  return '9 级以上'
}

/** 穿衣建议 */
function clothing(temp) {
  const t = Number(temp)
  if (isNaN(t)) return ''
  if (t < 0) return '羽绒服安排上，注意保暖'
  if (t < 8) return '厚外套，加件毛衣更暖'
  if (t < 15) return '外套刚刚好，早晚偏凉'
  if (t < 22) return '长袖加薄外套，舒适'
  if (t < 28) return '单衣即可，挺舒服'
  return '热，注意防晒补水'
}

/**
 * 拉取天气。
 * @param {object} opts { latitude, longitude, city }
 */
function fetchWeather(opts) {
  const o = opts || {}
  const params = [
    'latitude=' + (o.latitude != null ? o.latitude : 28.68),
    'longitude=' + (o.longitude != null ? o.longitude : 115.86),
    'current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m',
    'daily=temperature_2m_max,temperature_2m_min',
    'timezone=Asia%2FShanghai',
    'forecast_days=1'
  ]

  return new Promise((resolve, reject) => {
    wx.request({
      url: BASE + '?' + params.join('&'),
      method: 'GET',
      timeout: 10000,
      success: (res) => {
        if (res.statusCode !== 200 || !res.data) {
          reject(new Error('天气服务暂时不可用'))
          return
        }
        const d = res.data
        const cur = d.current || {}
        const day = (d.daily || {})
        const code = cur.weather_code
        const info = describe(code)

        resolve({
          temp: Math.round(cur.temperature_2m),
          feels: Math.round(cur.apparent_temperature),
          humidity: cur.relative_humidity_2m,
          wind: Math.round(cur.wind_speed_10m),
          windLevel: windLevel(cur.wind_speed_10m),
          text: info.text,
          icon: info.icon,
          high: day.temperature_2m_max ? Math.round(day.temperature_2m_max[0]) : null,
          low: day.temperature_2m_min ? Math.round(day.temperature_2m_min[0]) : null,
          updatedAt: Date.now(),
          city: o.city || ''
        })
      },
      fail: (e) => {
        const msg = (e && e.errMsg) || ''
        // 域名未登记时微信会直接拦截，errMsg 形如 "request:fail url not in domain list"
        if (/domain/i.test(msg)) {
          reject(new Error('天气域名未授权，需在平台后台添加 api.open-meteo.com'))
          return
        }
        if (/timeout/i.test(msg)) {
          reject(new Error('天气接口超时，稍后再试'))
          return
        }
        reject(new Error('网络不给力，天气没取到'))
      }
    })
  })
}

module.exports = { fetchWeather, describe, windLevel, clothing, CODES }
