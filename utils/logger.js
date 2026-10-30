/**
 * 轻量日志器。
 *
 * 为什么要专门封一层：
 * 1. **正式版不该打日志**。线上既看不到，又白白付出
 *    `JSON.stringify()` 的开销（尤其在上传这种批量操作里）。
 * 2. **异常必须留着**。`console.error` / `console.warn` 保留原样，
 *    保证线上问题还能排查——所以只收敛「过程性日志」，不碰错误日志。
 * 3. 收拢到一处，以后要加采样、限流、埋点只改这个文件。
 *
 * 开发版与体验版开启，正式版静默。
 */

let enabled = false;
try {
  const info = wx.getAccountInfoSync();
  const env = info && info.miniProgram && info.miniProgram.envVersion;
  enabled = env === 'develop' || env === 'trial';
} catch (e) {
  // 取不到环境信息时按关闭处理，宁可少打日志也不要影响性能
  enabled = false;
}

/** 过程性日志：仅开发/体验版输出 */
function log(...args) {
  if (!enabled) return;
  console.log(...args);
}

/** 当前是否处于开发日志模式（其它模块可据此跳过昂贵的准备工作） */
function isEnabled() {
  return enabled;
}

module.exports = { log, isEnabled };
