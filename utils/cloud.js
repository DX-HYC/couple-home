const { createMiniProgramWorkBuddyCloud } = require('@tencent-ai/workbuddy-cloud-sdk/miniprogram')
const { createDiagnosticWx } = require('./workbuddy-cloud-diagnostics')

// publicConfig 来自云服务开通结果，切勿手写或改写
const publicConfig = {
  endpoint: 'https://你的云服务地址',
  publishableKey: '你的 publishableKey'
}

const cloud = createMiniProgramWorkBuddyCloud({
  endpoint: publicConfig.endpoint,
  publishableKey: publicConfig.publishableKey,
  wx: createDiagnosticWx(wx)
})

module.exports = { cloud, publicConfig }
