import type { VercelRequest, VercelResponse } from '@vercel/node';

// 这是一个通用的 CORS 处理函数，允许你的 Chrome 插件访问这个接口
// 为了安全，生产环境可以将 allowOrigin 限制为你的插件 ID： chrome-extension://<your-id>
const allowCors = (fn: any) => async (req: VercelRequest, res: VercelResponse) => {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  // 允许所有来源，或者你可以指定你的插件ID
  res.setHeader('Access-Control-Allow-Origin', '*'); 
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // 浏览器会在正式请求前发送 OPTIONS 请求来询问权限
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  return await fn(req, res);
};

// 核心处理逻辑
const handler = async (req: VercelRequest, res: VercelResponse) => {
  // 1. 获取请求的方法 (GET/POST)
  const method = req.method;

  // 2. 读取环境变量 (我们在 Vercel 后台配置的飞书密钥)
  const APP_ID = process.env.LARK_APP_ID;
  const APP_SECRET = process.env.LARK_APP_SECRET;

  // 简单检查一下配置是否存在
  if (!APP_ID || !APP_SECRET) {
    return res.status(500).json({ 
      success: false, 
      message: "Server Error: Lark Credentials not configured." 
    });
  }

  // --- 这里是临时的测试逻辑，证明连接成功 ---
  
  // 如果是 GET 请求，返回成功信号
  if (method === 'GET') {
    return res.status(200).json({
      success: true,
      message: "JadeLink Proxy is Running!",
      timestamp: Date.now(),
      backend: "Vercel"
    });
  }

  // 如果是 POST 请求，回显数据 (Echo)
  if (method === 'POST') {
    const body = req.body;
    return res.status(200).json({
      success: true,
      message: "Received POST request",
      echo: body
    });
  }

  return res.status(405).json({ success: false, message: "Method Not Allowed" });
};

// 导出包裹了 CORS 处理的函数
module.exports = allowCors(handler);
