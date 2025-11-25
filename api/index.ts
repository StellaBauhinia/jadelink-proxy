import type { VercelRequest, VercelResponse } from '@vercel/node';

// --- 配置区域 ---
const LARK_API_BASE = 'https://open.feishu.cn/open-apis';



// --- 辅助函数 ---

// 1. 获取 tenant_access_token
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



// 3. 搜索记录 (List records with filter)
async function searchRecords(token: string, baseToken: string, tableId: string, filter?: string) {
  let url = `${LARK_API_BASE}/bitable/v1/apps/${baseToken}/tables/${tableId}/records?page_size=500`;
  if (filter) {
    url += `&filter=${encodeURIComponent(filter)}`;
  }

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await res.json() as any;
  if (data.code !== 0) throw new Error(`Search Records Failed: ${data.msg}`);
  return data.data.items || [];
}

// 4. 创建记录
async function createRecord(token: string, baseToken: string, tableId: string, fields: any) {
  const res = await fetch(`${LARK_API_BASE}/bitable/v1/apps/${baseToken}/tables/${tableId}/records`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields })
  });
  const data = await res.json() as any;
  if (data.code !== 0) throw new Error(`Create Record Failed: ${data.msg}`);
  return data.data.record;
}

// 5. 更新记录
async function updateRecord(token: string, baseToken: string, tableId: string, recordId: string, fields: any) {
  const res = await fetch(`${LARK_API_BASE}/bitable/v1/apps/${baseToken}/tables/${tableId}/records/${recordId}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields })
  });
  const data = await res.json() as any;
  if (data.code !== 0) throw new Error(`Update Record Failed: ${data.msg}`);
  return data.data.record;
}

// 6. 删除记录
async function deleteRecord(token: string, baseToken: string, tableId: string, recordId: string) {
  const res = await fetch(`${LARK_API_BASE}/bitable/v1/apps/${baseToken}/tables/${tableId}/records/${recordId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await res.json() as any;
  if (data.code !== 0) throw new Error(`Delete Record Failed: ${data.msg}`);
  return data;
}


// 主处理逻辑
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
  const TABLE_PROJECTS = process.env.LARK_TABLE_PROJECTS;
  const TABLE_COMMENTS = process.env.LARK_TABLE_COMMENTS;

  if (!APP_ID || !APP_SECRET || !BASE_TOKEN || !TABLE_PROJECTS || !TABLE_COMMENTS) {
    return res.status(500).json({ success: false, message: "Server Config Error: Missing Envs" });
  }

  try {
    const token = await getLarkToken(APP_ID, APP_SECRET);

    const projectsTableId = TABLE_PROJECTS;
    const commentsTableId = TABLE_COMMENTS;

    if (action === 'INIT_PROJECT') {
      const { projectName, nickname, pages } = payload;
      const projectId = `proj-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

      const config = {
        pages: pages || []
      };

      await createRecord(token, BASE_TOKEN, projectsTableId, {
        id: projectId,
        name: projectName,
        owner: nickname,
        createdAt: Date.now(),
        config: JSON.stringify(config)
      });

      return res.status(200).json({
        success: true,
        data: {
          projectId: projectId,
          backendType: 'LARK_PROXY'
        }
      });
    }

    if (action === 'UPDATE_PROJECT_CONFIG') {
      const { projectId, config } = payload;
      if (!projectId) return res.status(400).json({ success: false, message: 'Missing projectId' });

      const filter = `CurrentValue.[id] = "${projectId}"`;
      const records = await searchRecords(token, BASE_TOKEN, projectsTableId, filter);

      if (records.length === 0) {
        return res.status(404).json({ success: false, message: 'Project not found' });
      }

      const recordId = records[0].record_id;

      await updateRecord(token, BASE_TOKEN, projectsTableId, recordId, {
        config: JSON.stringify(config)
      });

      return res.status(200).json({ success: true, message: 'Config updated' });
    }

    if (action === 'GET_COMMENTS') {
      const { projectId, pageUrl } = payload;
      const filter = `AND(CurrentValue.[projectId]="${projectId}", CurrentValue.[pageUrl]="${pageUrl}")`;
      const records = await searchRecords(token, BASE_TOKEN, commentsTableId, filter);

      const threads: any[] = [];
      const replies: any[] = [];

      records.forEach((r: any) => {
        const f = r.fields;
        const item = {
          recordId: r.record_id,
          ...f,
          content: f.content ? JSON.parse(f.content) : {}
        };

        if (item.type === 'THREAD') {
          threads.push({
            commentId: item.id,
            pageUrl: item.pageUrl,
            selector: item.selector,
            initialComment: item.content,
            status: item.status,
            replies: []
          });
        } else if (item.type === 'REPLY') {
          replies.push({
            replyId: item.id,
            parentId: item.parentId,
            ...item.content
          });
        }
      });

      threads.forEach(t => {
        t.replies = replies.filter(r => r.parentId === t.commentId);
      });

      return res.status(200).json({ success: true, data: threads });
    }

    if (action === 'GET_PROJECT_CONFIG') {
      const { projectId } = payload;
      if (!projectId) return res.status(400).json({ success: false, message: 'Missing projectId' });

      const filter = `CurrentValue.[id] = "${projectId}"`;
      const records = await searchRecords(token, BASE_TOKEN, projectsTableId, filter);

      if (records.length === 0) {
        return res.status(404).json({ success: false, message: 'Project not found' });
      }

      const projectRecord = records[0];
      let config = {};
      try {
        config = JSON.parse(projectRecord.fields.config || '{}');
      } catch (e) {
        console.error('Failed to parse project config', e);
      }

      return res.status(200).json({ success: true, data: config });
    }

    if (action === 'CREATE_THREAD') {
      const { projectId, commentId, pageUrl, selector, commentText, author, status, timestamp } = payload;
      const content = JSON.stringify({ author, commentText, timestamp });

      await createRecord(token, BASE_TOKEN, commentsTableId, {
        id: commentId,
        projectId,
        type: 'THREAD',
        pageUrl,
        selector,
        content,
        status,
        timestamp: new Date(timestamp).getTime()
      });

      return res.status(200).json({ success: true, message: 'Thread created' });
    }

    if (action === 'ADD_REPLY') {
      const { projectId, replyId, parentId, commentText, author, timestamp } = payload;

      const parentFilter = `CurrentValue.[id]="${parentId}"`;
      const parents = await searchRecords(token, BASE_TOKEN, commentsTableId, parentFilter);
      if (parents.length === 0) throw new Error('Parent thread not found');
      const parentPageUrl = parents[0].fields.pageUrl;

      const content = JSON.stringify({ author, commentText, timestamp });

      await createRecord(token, BASE_TOKEN, commentsTableId, {
        id: replyId,
        projectId,
        type: 'REPLY',
        parentId,
        pageUrl: parentPageUrl,
        content,
        timestamp: new Date(timestamp).getTime()
      });

      return res.status(200).json({ success: true, message: 'Reply added' });
    }

    if (action === 'UPDATE_STATUS') {
      const { commentId, newStatus } = payload;
      const filter = `CurrentValue.[id]="${commentId}"`;
      const records = await searchRecords(token, BASE_TOKEN, commentsTableId, filter);
      if (records.length === 0) throw new Error('Thread not found');

      const recordId = records[0].record_id;
      await updateRecord(token, BASE_TOKEN, commentsTableId, recordId, {
        status: newStatus
      });
      return res.status(200).json({ success: true, message: 'Status updated' });
    }

    if (action === 'DELETE_THREAD') {
      const { commentId } = payload;
      const filter = `CurrentValue.[id]="${commentId}"`;
      const records = await searchRecords(token, BASE_TOKEN, commentsTableId, filter);
      if (records.length > 0) {
        await deleteRecord(token, BASE_TOKEN, commentsTableId, records[0].record_id);
      }

      const replyFilter = `CurrentValue.[parentId]="${commentId}"`;
      const replies = await searchRecords(token, BASE_TOKEN, commentsTableId, replyFilter);
      await Promise.all(replies.map((r: any) => deleteRecord(token, BASE_TOKEN, commentsTableId, r.record_id)));

      return res.status(200).json({ success: true, message: 'Thread deleted' });
    }

    return res.status(400).json({ success: false, message: `Unknown action: ${action}` });

  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = allowCors(handler);
