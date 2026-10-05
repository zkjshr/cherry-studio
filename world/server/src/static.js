// 静态托管：world/frontend/dist（WORLD_FRONTEND_DIST 可覆盖）；缺失时回退占位页
import fs from 'node:fs'
import path from 'node:path'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
}

export function placeholderHtml() {
  return `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>小世界</title></head>
<body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;color:#555">
  <div style="text-align:center">
    <h1>小世界（Little World）</h1>
    <p>frontend not built —— 前端尚未构建，请先构建 world/frontend/dist</p>
  </div>
</body>
</html>
`
}

/**
 * 返回 (req, res) 处理器：GET/HEAD 静态文件 + SPA 回退。
 * - 精确文件存在 → 按扩展名回内容类型
 * - 目录 → 其下 index.html
 * - 其余 GET（无扩展名的 SPA 路由）→ dist/index.html
 * - dist 根本不存在 → 占位页「frontend not built」
 */
export function makeStaticHandler(distRoot) {
  const resolvedRoot = path.resolve(distRoot)
  return (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' })
      res.end()
      return
    }
    let pathname
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
    } catch {
      res.writeHead(400)
      res.end()
      return
    }
    if (pathname.includes('\0')) {
      res.writeHead(400)
      res.end()
      return
    }

    let filePath = path.normalize(path.join(resolvedRoot, pathname))
    // 路径穿越防护
    if (filePath !== resolvedRoot && !filePath.startsWith(resolvedRoot + path.sep)) {
      res.writeHead(403)
      res.end()
      return
    }

    let stat = null
    try {
      stat = fs.statSync(filePath)
    } catch {
      stat = null
    }
    if (stat?.isDirectory()) {
      filePath = path.join(filePath, 'index.html')
      stat = statSyncQuiet(filePath)
    }

    const distExists = fs.existsSync(resolvedRoot)
    if (!stat?.isFile()) {
      if (!hasFileExtension(pathname)) {
        // 无扩展名 → SPA 回退（dist/index.html），dist 缺失 → 占位页
        const index = statSyncQuiet(path.join(resolvedRoot, 'index.html'))
        if (index?.isFile()) {
          sendFile(req, res, path.join(resolvedRoot, 'index.html'), 200)
        } else {
          sendBuffer(req, res, Buffer.from(placeholderHtml(), 'utf8'), 'text/html; charset=utf-8', 200)
        }
        return
      }
      // 带扩展名但文件不存在（含 dist 整体缺失）→ 404
      res.writeHead(404)
      res.end()
      return
    }
    sendFile(req, res, filePath, 200)
  }
}

function hasFileExtension(p) {
  return path.extname(p) !== ''
}

function statSyncQuiet(p) {
  try {
    return fs.statSync(p)
  } catch {
    return null
  }
}

function sendFile(req, res, filePath, status) {
  const type = MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream'
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(500)
      res.end()
      return
    }
    sendBuffer(req, res, data, type, status)
  })
}

function sendBuffer(req, res, data, type, status) {
  res.writeHead(status, {
    'Content-Type': type,
    'Content-Length': data.length,
    'Cache-Control': 'no-cache'
  })
  res.end(req.method === 'HEAD' ? undefined : data)
}
