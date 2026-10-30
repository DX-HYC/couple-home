/**
 * 逆地理编码：经纬度 -> 地名。
 *
 * 微信 wx.getLocation 只返回经纬度（gcj02 火星坐标系），不返回文字地址。
 * 要把坐标变成「南昌影视传播职业学院」这样的名称，必须调用第三方逆地理编码。
 *
 * 这里用腾讯位置服务（WebService API）：
 * - 坐标系与微信一致（gcj02），拿到的经纬度可以直接传，无需转换
 * - 免费额度对个人使用足够（默认 1 万次/日）
 * - 会返回最近 POI 名称 + 结构化地址，POI 名通常就是学校/公司/商场名
 *
 * 使用前需要两步配置（缺一不可）：
 * 1. 到 https://lbs.qq.com 申请 WebService 类型 key，填入下方 LBS_KEY
 * 2. 小程序后台「开发管理 - 开发设置 - request 合法域名」添加 https://apis.map.qq.com
 *    （开发/体验版可在详情里勾选「不校验合法域名」）
 */

// ============ 在这里填入你的腾讯位置服务 key ============
const LBS_KEY = ''
// ========================================================

/** 单位：米。移动小于这个距离就不重新反查，省配额也避免地名跳动 */
const MIN_MOVE_METERS = 40

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lng2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)))
}

/** key 是否已配置 */
function isReady() {
  return !!LBS_KEY
}

/**
 * 逆地理编码。
 * @param {number} latitude  gcj02 纬度
 * @param {number} longitude gcj02 经度
 * @returns {Promise<null|{poi:string, address:string, city:string, district:string}>}
 *          失败返回 null，由调用方降级
 */
async function reverseGeocode(latitude, longitude) {
  if (!isReady()) return null
  if (latitude == null || longitude == null) return null

  const url = 'https://apis.map.qq.com/ws/geocoder/v1/' +
    '?location=' + latitude + ',' + longitude +
    '&key=' + LBS_KEY +
    '&get_poi=1' +
    '&poi_options=radius=200;policy=1'

  return new Promise((resolve) => {
    wx.request({
      url: url,
      method: 'GET',
      success: (res) => {
        if (res.statusCode !== 200 || !res.data) {
          resolve(null)
          return
        }
        const body = res.data
        if (body.status !== 0) {
          console.warn('[geo] 逆地理编码失败', JSON.stringify({ status: body.status, message: body.message }))
          resolve(null)
          return
        }
        const result = body.result || {}
        // POI 名称优先：通常是学校/公司/小区名，比纯地址更易读
        const poi = result.pois && result.pois.length
          ? (result.pois[0].title || result.pois[0].name || '')
          : ''
        const address = result.formatted_addresses
          ? (result.formatted_addresses.recommend || result.address || '')
          : (result.address || '')
        const comp = result.address_component || {}
        resolve({
          poi: poi,
          address: address,
          city: comp.city || comp.province || '',
          district: comp.district || ''
        })
      },
      fail: (e) => {
        console.warn('[geo] 逆地理编码请求失败', JSON.stringify({ errMsg: e.errMsg }))
        resolve(null)
      }
    })
  })
}

/**
 * 判断是否需要重新反查：距离上次太近就复用旧结果。
 * @param {{latitude, longitude, address, city}} prev 上一次的记录
 */
function shouldRefetch(prev, latitude, longitude) {
  if (!prev || !prev.address) return true
  if (prev.latitude == null || prev.longitude == null) return true
  return haversine(prev.latitude, prev.longitude, latitude, longitude) > MIN_MOVE_METERS
}

/** 组装最终展示文案：有 POI 显示「POI · 地址」，否则只有地址 */
function buildDisplay(info) {
  if (!info) return { text: '', hasText: false }
  const poi = (info.poi || '').trim()
  const addr = (info.address || '').trim()
  if (poi && addr && addr.indexOf(poi) === -1) {
    return { text: poi + ' · ' + addr, hasText: true }
  }
  return { text: addr || poi, hasText: !!(addr || poi) }
}

module.exports = { reverseGeocode, shouldRefetch, buildDisplay, isReady, haversine }
