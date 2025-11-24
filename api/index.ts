import type { VercelRequest, VercelResponse } from '@vercel/node';

// --- 配置区域 ---
const LARK_API_BASE = 'https://open.feishu.cn/open-apis';

// 定义我们需要在飞书表格中创建的字段
// 采用"扁平化"存储策略，与 Google Sheet 逻辑一致
const SCHEMA = [
  { field_name: 'id', type: 1 }, // 1 = Text (评论ID 或 回复ID)
  { field_name: 'type', type: 1 }, // Text ('THREAD' | 'REPLY')
  { field_name: 'parentId', type: 1 }, // Text (关联的主题ID)
  { field_name: 'content', type: 1 }, // Text (JSON 字符串，存储核心内容)
  { field_name: 'status', type: 1 }, // Text ('Open', 'Resolved' etc.)
  { field_name: 'pageUrl', type: 1 }, // Text
  { field_name: 'created_at', type: 5 } // 5 = Date (创建时间)
];

// --- 辅助函数 ---

// 1. 获取 tenant_access_token (飞书 API 的通行证)
async function getLarkToken(appId: string, appSecret: string): Promise<string> {
  const res = await fetch(`${LARK_API_BASE}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret })
  });
  const data = await res.json() as any;
  if (data.code !== 0) throw new Error(`Auth Failed: ${data.msg}`);
  return data.tenant_access_token;
}

// 2. 在指定 Base 中创建新表
async function createTable(token: string, baseToken: string, tableName: string) {
  const res = await fetch(`${LARK_API_BASE}/bitable/v1/apps/${baseToken}/tables`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ table: { name: tableName } })
  });
  const data = await res.json() as any;
  if (data.code !== 0) throw new Error(`Create Table Failed: ${data.msg}`);
  return data.data.table_id;
}

// 3. 为表添加字段
async function addField(token: string, baseToken: string, tableId: string, fieldName: string, fieldType: number) {
  const res = await fetch(`${LARK_API_BASE}/bitable/v1/apps/${baseToken}/tables/${tableId}/fields`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ field_name: fieldName, type: fieldType })
  });
  // 我们不抛出错误，因为如果重名字段可能失败，我们忽略即可
  return await res.json();
}

// 主处理逻辑
// 为了安全，生产环境可以将 allowOrigin 限制为你的插件 ID： chrome-extension://<your-id>
const allowCors = (fn: any) => async (req: VercelRequest, res: VercelResponse) => {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  return await fn(req, res);
};

const handler = async (req: VercelRequest, res: VercelResponse) => {
  const { action, payload } = req.body || {};
  const APP_ID = process.env.LARK_APP_ID;
  const APP_SECRET = process.env.LARK_APP_SECRET;
  const BASE_TOKEN = process.env.LARK_BASE_TOKEN;

  if (!APP_ID || !APP_SECRET || !BASE_TOKEN) {
    return res.status(500).json({ success: false, message: "Server Config Error: Missing Envs" });
  }

  try {
    // 1. 拿到 Token
    const token = await getLarkToken(APP_ID, APP_SECRET);

    // 2. 处理初始化项目请求
    if (action === 'INIT_PROJECT') {
      const projectName = payload?.projectName || 'Untitled Project';
      // 为了避免表名重复，加个时间戳后缀
      const uniqueName = `${projectName.substring(0, 50)}_${Date.now().toString().slice(-4)}`;

      // A. 创建表
      const tableId = await createTable(token, BASE_TOKEN, uniqueName);
      
      // B. 并行创建字段 (为了速度)
      // 注意：新建表默认会有一个"多维表格"字段，我们不管它，直接加我们的
      await Promise.all(SCHEMA.map(f => addField(token, BASE_TOKEN, tableId, f.field_name, f.type)));

      // C. 返回配置信息给插件
      return res.status(200).json({
        success: true,
        data: {
          backendType: 'LARK',
          larkConfig: {
            tableId: tableId,
            // 我们不需要返回 baseToken，因为插件后续请求还是发给 Vercel，
            // Vercel 从环境变量读 BaseToken，这样更安全
          }
        }
      });
    }

    // 3. 处理其他请求 (GET_COMMENTS, CREATE_THREAD 等 - 留给下一步)
    return res.status(400).json({ success: false, message: `Unknown action: ${action}` });

  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// 导出包裹了 CORS 处理的函数
module.exports = allowCors(handler);
