// Vercel Serverless Function 入口（catch-all）。
// 复用 server.js 导出的请求处理函数，由 vercel.json 的 rewrites 把所有请求转发到这里。
// 注意：Vercel 运行此函数需要 Node 22.5+ 且启用 node:sqlite（通过 vercel.json 的 NODE_OPTIONS）。
module.exports = require('../server/server.js');
