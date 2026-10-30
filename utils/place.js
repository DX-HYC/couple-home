/**
 * 位置地址解析。
 *
 * 微信小程序的 wx.getLocation 只返回经纬度，不返回文字地址；
 * wx.getFuzzyLocation 只会返回粗略位置。要拿到「XX市XX区XX路」这种可读地址，
 * 有两条路：
 *
 * 1. wx.chooseLocation —— 拉起微信自带的选点地图，用户点一下确认，
 *    返回真实的 POI 名称与详细地址。无需任何第三方服务，也不需要额外密钥。
 * 2. 第三方逆地理编码接口 —— 需要申请 key 并在小程序后台配置 request 合法域名。
 *
 * 本项目采用方案 1：定位成功后，若还没有可读地址，就引导用户点一下确认地点，
 * 确认后把「地址文案」持久化下来，之后双方看到的都是文字而不是经纬度。
 */

/** 把坐标保留到小数点后 4 位，够用且便于口头交流 */
function coordText(v) {
  const n = Number(v)
  return isNaN(n) ? '' : n.toFixed(4)
}

/** 根据距离给一句人话 */
function describeDistance(meters) {
  if (meters == null || isNaN(meters)) return ''
  if (meters < 30) return '就在附近'
  if (meters < 1000) return '相距约 ' + Math.round(meters) + ' 米'
  return '相距约 ' + (meters / 1000).toFixed(1) + ' 公里'
}

/** 两个坐标的球面距离（米） */
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)))
}

/**
 * 组装一条可读的地址文案。
 * 有详细地址就用地址，否则退化到坐标并明确提示这是坐标。
 */
function formatPlace(address, latitude, longitude) {
  const text = (address || '').trim()
  if (text) return { place: text, hasText: true }
  return {
    place: '尚未标注地点（' + coordText(latitude) + ', ' + coordText(longitude) + '）',
    hasText: false
  }
}

/** 相对时间，如「刚刚 / 3 分钟前 / 2 小时前」 */
function relativeTime(iso) {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (isNaN(t)) return ''
  const diff = Date.now() - t
  if (diff < 0) return '刚刚'
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return min + ' 分钟前'
  const hour = Math.floor(min / 60)
  if (hour < 24) return hour + ' 小时前'
  const day = Math.floor(hour / 24)
  if (day < 30) return day + ' 天前'
  const d = new Date(t)
  return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate()
}

module.exports = { coordText, describeDistance, haversine, formatPlace, relativeTime }
