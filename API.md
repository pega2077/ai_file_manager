# API 接口规范

## 统一响应格式

所有 API 接口都遵循统一的响应格式：

```json
{
  "success": boolean,
  "message": string,
  "data": any,
  "error": {
    "code": string,
    "message": string,
    "details": any
  } | null,
  "timestamp": string,
  "request_id": string
}
```

### 响应字段说明

- `success`: 请求是否成功 (true/false)
- `message`: 响应消息描述
- `data`: 响应数据，成功时包含具体数据
- `error`: 错误信息，失败时包含错误详情
- `timestamp`: 响应时间戳 (ISO 8601 格式)
- `request_id`: 请求唯一标识符

### HTTP 状态码规范

- `200`: 请求成功
- `400`: 请求参数错误
- `401`: 认证失败
- `403`: 权限不足
- `404`: 资源不存在
- `500`: 服务器内部错误

### 请求方法规范

本接口仅使用 GET 和 POST 两种 HTTP 方法：
- `GET`: 用于数据查询和获取操作
- `POST`: 用于数据创建、更新、删除等所有变更操作

## 接口总览

| 功能模块 | 接口名称 | 方法 | 接口路径 | 说明 |
|---------|---------|------|----------|------|
| 文件管理 | 添加文件 | POST | `/api/files/import` | 导入文件到工作区 |
| 文件管理 | 文件列表 | POST | `/api/files/list` | 获取文件列表（支持筛选） |
| 文件管理 | 文件详情 | GET | `/api/files/{file_id}` | 获取单个文件详情 |
| 文件管理 | 删除文件 | POST | `/api/files/delete` | 删除指定文件 |
| 文件管理 | 更新文件 | POST | `/api/files/update` | 更新文件信息 |
| 文件管理 | 创建文件夹结构 | POST | `/api/files/create-folders` | 创建文件夹结构 |
| 文件管理 | 列出目录结构 | POST | `/api/files/list-directory` | 列出目录内容 |
| 文件管理 | 递归列出目录结构 | POST | `/api/files/list-directory-recursive` | 递归列出目录树结构 |
| 文件管理 | 文件预览 | POST | `/api/files/preview` | 预览文件内容（文本/图片） |
| 文件管理 | 保存文件 | POST | `/api/files/save-file` | 保存文件到指定目录 |
| 文档分段 | 分段列表 | POST | `/api/files/chunks/list` | 获取文件分段列表 |
| 文档分段 | 重新分段 | POST | `/api/files/reprocess` | 重新处理文件分段 |
| 搜索检索 | 语义搜索 | POST | `/api/search/semantic` | 基于向量的语义搜索 |
| 搜索检索 | 关键词搜索 | POST | `/api/search/keyword` | 基于关键词的全文搜索 |
| RAG问答 | 智能问答 | POST | `/api/chat/ask` | 基于RAG的智能问答 |
| RAG问答 | 对话历史 | POST | `/api/chat/history` | 获取对话历史记录 |
| RAG问答 | 目录结构推荐 | POST | `/api/chat/directory-structure` | 基于职业和用途推荐目录结构 |
| RAG问答 | 推荐存放目录 | POST | `/api/chat/recommend-directory` | 基于文件内容推荐存放目录 |
| 系统管理 | 系统状态 | GET | `/api/system/status` | 获取系统运行状态 |
| 系统管理 | 系统配置 | GET | `/api/system/config` | 获取系统配置信息 |
| 系统管理 | 更新配置 | POST | `/api/system/config/update` | 更新系统配置 |

## 1. 文件管理模块接口

### 1.1 添加文件到工作区

**接口**: `POST /api/files/import`

**请求参数**:
```json
{
  "file_path": "string",
  "category": "string", // 可选，手动指定分类
  "tags": ["string"],   // 可选，手动指定标签
  "auto_process": true, // 是否自动处理（分类、摘要、embedding）
  "directory_structure": [ // 可选，目录结构上下文，用于智能分类
    {
      "name": "string",
      "type": "folder|file"
    }
  ]
}
```

**请求参数说明**:
- `file_path`: 要导入的本地文件路径
- `category`: 可选，手动指定分类
- `tags`: 可选，手动指定标签数组
- `auto_process`: 是否自动处理（分类、摘要、embedding），默认为 true
- `directory_structure`: 可选，目录结构上下文，当提供时会用于生成更准确的分类建议

**响应数据**:
```json
{
  "file_id": "string",
  "name": "string",
  "path": "string",
  "type": "string",
  "size": "number",
  "category": "string",
  "summary": "string",
  "tags": ["string"],
  "added_at": "string",
  "processed": "boolean"
}
```

### 1.2 获取文件列表

**接口**: `POST /api/files/list`

**请求参数**:
```json
{
  "page": "number",        // 默认 1
  "limit": "number",       // 默认 20
  "category": "string",    // 可选，分类筛选
  "type": "string",        // 可选，文件类型筛选
  "search": "string",      // 可选，关键词搜索
  "tags": ["string"]       // 可选，标签筛选
}
```

**响应数据**:
```json
{
  "files": [
    {
      "id": "string",
      "name": "string",
      "path": "string",
      "type": "string",
      "category": "string",
      "summary": "string",
      "tags": ["string"],
      "size": "number",
      "added_at": "string",
      "updated_at": "string"
    }
  ],
  "pagination": {
    "current_page": "number",
    "total_pages": "number",
    "total_count": "number",
    "limit": "number"
  }
}
```

### 1.3 获取文件详情

**接口**: `GET /api/files/{file_id}`

**响应数据**:
```json
{
  "id": "string",
  "name": "string",
  "path": "string",
  "type": "string",
  "category": "string",
  "summary": "string",
  "tags": ["string"],
  "size": "number",
  "chunks_count": "number",
  "added_at": "string",
  "updated_at": "string",
  "metadata": {
    "author": "string",
    "created_date": "string",
    "modified_date": "string"
  }
}
```

### 1.4 删除文件

**接口**: `POST /api/files/delete`

**请求参数**:
```json
{
  "file_id": "string"
}
```

**响应数据**:
```json
{
  "deleted_file_id": "string",
  "deleted_chunks_count": "number"
}
```

### 1.5 更新文件信息

**接口**: `POST /api/files/update`

**请求参数**:
```json
{
  "file_id": "string",
  "category": "string",
  "tags": ["string"],
  "summary": "string"
}
```

**响应数据**:
```json
{
  "id": "string",
  "name": "string",
  "category": "string",
  "tags": ["string"],
  "summary": "string",
  "updated_at": "string"
}
```

### 1.6 创建文件夹结构

**接口**: `POST /api/files/create-folders`

**请求参数**:
```json
{
  "target_folder": "string",
  "structure": [
    {
      "name": "string",
      "type": "folder"
    }
  ]
}
```

**请求参数说明**:
- `target_folder`: 目标文件夹路径，用于创建文件夹结构的根目录
- `structure`: 文件夹结构数组
  - `name`: 文件夹名称，支持嵌套路径（如 "Documents/Work"）
  - `type`: 项目类型，目前仅支持 "folder"

**响应数据**:
```json
{
  "target_folder": "string",
  "folders_created": "number"
}
```

**示例请求**:
```json
{
  "target_folder": "/path/to/workspace",
  "structure": [
    {
      "name": "Documents",
      "type": "folder"
    },
    {
      "name": "Documents/Work",
      "type": "folder"
    },
    {
      "name": "Images",
      "type": "folder"
    }
  ]
}
```

### 1.7 列出目录结构

**接口**: `POST /api/files/list-directory`

**请求参数**:
```json
{
  "directory_path": "string"
}
```

**请求参数说明**:
- `directory_path`: 要列出内容的目录路径

**响应数据**:
```json
{
  "directory_path": "string",
  "items": [
    {
      "name": "string",
      "type": "file|folder",
      "size": "number|null",
      "created_at": "string|null",
      "modified_at": "string|null",
      "item_count": "number|null"
    }
  ],
  "total_count": "number"
}
```

**字段说明**:
- `name`: 文件或文件夹名称
- `type`: 类型，"file" 或 "folder"
- `size`: 文件大小（字节），文件夹为 null
- `created_at`: 创建时间（ISO 8601格式），获取失败时为 null
- `modified_at`: 修改时间（ISO 8601格式），获取失败时为 null
- `item_count`: 文件夹内项目数量，文件为 null

**示例请求**:
```json
{
  "directory_path": "/path/to/directory"
}
```

**示例响应**:
```json
{
  "directory_path": "/path/to/directory",
  "items": [
    {
      "name": "Documents",
      "type": "folder",
      "size": null,
      "created_at": "2025-09-14T10:30:00",
      "modified_at": "2025-09-14T15:45:00",
      "item_count": 5
    },
    {
      "name": "readme.txt",
      "type": "file",
      "size": 1024,
      "created_at": "2025-09-14T09:15:00",
      "modified_at": "2025-09-14T14:20:00",
      "item_count": null
    },
    {
      "name": "image.jpg",
      "type": "file",
      "size": 2048576,
      "created_at": "2025-09-14T11:00:00",
      "modified_at": "2025-09-14T11:00:00",
      "item_count": null
    }
  ],
  "total_count": 3
}
```

### 1.8 文件预览

**接口**: `POST /api/files/preview`

**请求参数**:
```json
{
  "file_path": "string"
}
```

**请求参数说明**:
- `file_path`: 要预览的文件的完整路径

**支持的文件类型**:
- **文本文件**: `.txt`, `.md`, `.json`, `.py`, `.js`, `.ts`, `.html`, `.css`, `.xml`, `.yaml`, `.yml`, `.ini`, `.cfg`, `.conf`, `.log`, `.sh`, `.bat`, `.ps1`, `.sql`, `.csv`, `.rtf` 等
- **图片文件**: `.jpg`, `.jpeg`, `.png`, `.gif`, `.bmp`, `.webp`, `.svg`, `.ico` 等

**响应数据**:
```json
{
  "file_path": "string",
  "file_type": "text|image",
  "mime_type": "string",
  "content": "string",
  "size": "number",
  "truncated": "boolean"  // 仅文本文件，是否被截断
}
```

**字段说明**:
- `file_path`: 文件完整路径
- `file_type`: 文件类型，"text" 或 "image"
- `mime_type`: MIME 类型
- `content`: 
  - 文本文件：文件内容（前10KB）
  - 图片文件：base64编码的数据URI（如 "data:image/jpeg;base64,/9j/4AAQ..."）
- `size`: 文件大小（字节）
- `truncated`: 是否被截断（仅文本文件）
- `encoding`: 使用的文本编码（仅文本文件）

**支持的文本编码**:
- UTF-8 (默认)
- GBK
- GB2312
- UTF-16
- Latin-1

如果所有编码尝试都失败，将返回错误信息。

**示例请求**:
```json
{
  "file_path": "/path/to/document.txt"
}
```

**示例响应** (文本文件):
```json
{
  "file_path": "/path/to/document.txt",
  "file_type": "text",
  "mime_type": "text/plain",
  "content": "This is the content of the text file...",
  "size": 1024,
  "truncated": false
}
```

**示例响应** (图片文件):
```json
{
  "file_path": "/path/to/image.jpg",
  "file_type": "image",
  "mime_type": "image/jpeg",
  "content": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAhEAACAQMDBQAAAAAAAAAAAAABAgMABAUGIWGRkqGx0f/EABUBAQEAAAAAAAAAAAAAAAAAAAMF/8QAGhEAAgIDAAAAAAAAAAAAAAAAAAECEgMRkf/aAAwDAQACEQMRAD8AltJagyeH0AthI5xdrLcNM91BF5pX2HaH9bcfaSXWGaRmknyJckliyjqTzSlT54b6bk+h0R+IRjWjBqO6O2mhP//Z",
  "size": 2048576
}
```

### 1.10 递归列出目录结构

**接口**: `POST /api/files/list-directory-recursive`

**请求参数**:
```json
{
  "directory_path": "string",
  "max_depth": "number"
}
```

**请求参数说明**:
- `directory_path`: 要递归列出的目录路径
- `max_depth`: 最大遍历深度（1-10，默认3）

**响应数据**:
```json
{
  "directory_path": "string",
  "max_depth": "number",
  "items": [
    {
      "name": "string",
      "type": "folder|file",
      "path": "string",
      "relative_path": "string",
      "depth": "number",
      "size": "number|null",
      "created_at": "string|null",
      "modified_at": "string|null",
      "item_count": "number|null"
    }
  ],
  "total_count": "number"
}
```

**字段说明**:
- `items`: 文件和文件夹的列表
  - `name`: 项目名称
  - `type`: 类型（"folder" 或 "file"）
  - `path`: 完整路径
  - `relative_path`: 相对于目标目录的相对路径
  - `depth`: 当前深度级别
  - `size`: 文件大小（仅文件）
  - `created_at`: 创建时间
  - `modified_at`: 修改时间
  - `item_count`: 子项数量（仅文件夹）

**示例请求**:
```json
{
  "directory_path": "/path/to/directory",
  "max_depth": 2
}
```

**示例响应**:
```json
{
  "directory_path": "/path/to/directory",
  "max_depth": 2,
  "items": [
    {
      "name": "directory",
      "type": "folder",
      "path": "/path/to/directory",
      "relative_path": ".",
      "depth": 0,
      "created_at": "2025-09-14T10:30:00",
      "modified_at": "2025-09-14T15:45:00",
      "item_count": 2
    },
    {
      "name": "Documents",
      "type": "folder",
      "path": "/path/to/directory/Documents",
      "relative_path": "Documents",
      "depth": 1,
      "created_at": "2025-09-14T10:35:00",
      "modified_at": "2025-09-14T14:20:00",
      "item_count": 1
    },
    {
      "name": "readme.txt",
      "type": "file",
      "path": "/path/to/directory/Documents/readme.txt",
      "relative_path": "Documents/readme.txt",
      "depth": 2,
      "size": 1024,
      "created_at": "2025-09-14T10:40:00",
      "modified_at": "2025-09-14T10:40:00"
    },
    {
      "name": "image.jpg",
      "type": "file",
      "path": "/path/to/directory/image.jpg",
      "relative_path": "image.jpg",
      "depth": 1,
      "size": 2048576,
      "created_at": "2025-09-14T11:00:00",
      "modified_at": "2025-09-14T11:00:00"
    }
  ],
  "total_count": 4
}
```

### 1.9 保存文件到指定目录

**接口**: `POST /api/files/save-file`

**请求参数**:
```json
{
  "source_file_path": "string",
  "target_directory": "string",
  "overwrite": "boolean"
}
```

**请求参数说明**:
- `source_file_path`: 要保存的源文件路径
- `target_directory`: 目标目录路径（相对于工作目录）
- `overwrite`: 是否覆盖同名文件，默认为 false

**处理逻辑**:
1. 检查目标目录是否存在，不存在则自动创建
2. 检查目标目录是否已有同名文件
3. 如果 `overwrite=true`：直接覆盖
4. 如果 `overwrite=false` 且存在同名文件：为文件名添加时间戳（格式：`YYYYMMDD_HHMMSS`）
5. 复制文件到目标位置

**响应数据**:
```json
{
  "source_file_path": "string",
  "saved_path": "string",
  "filename": "string",
  "overwritten": "boolean"
}
```

**字段说明**:
- `source_file_path`: 源文件路径
- `saved_path`: 保存后的完整路径
- `filename`: 保存的文件名
- `overwritten`: 是否覆盖了现有文件

**示例请求**:
```json
{
  "source_file_path": "/path/to/source/document.pdf",
  "target_directory": "exports/backup",
  "overwrite": false
}
```

**示例响应**:
```json
{
  "source_file_path": "/path/to/source/document.pdf",
  "saved_path": "d:\\Projects\\ai_file_manager\\workdir\\exports\\backup\\document.pdf",
  "filename": "document.pdf",
  "overwritten": false
}
```

**错误情况**:
- `SOURCE_FILE_MISSING`: 源文件不存在
- `SAVE_FILE_ERROR`: 保存文件失败

## 2. 文档分段模块接口

### 2.1 获取文件分段列表

**接口**: `POST /api/files/chunks/list`

**请求参数**:
```json
{
  "file_id": "string",
  "page": "number",        // 默认 1
  "limit": "number"        // 默认 50
}
```

**响应数据**:
```json
{
  "chunks": [
    {
      "id": "string",
      "file_id": "string",
      "chunk_index": "number",
      "content": "string",
      "content_type": "text|heading|code|table",
      "char_count": "number",
      "token_count": "number",
      "embedding_id": "string",
      "created_at": "string"
    }
  ],
  "pagination": {
    "current_page": "number",
    "total_pages": "number",
    "total_count": "number",
    "limit": "number"
  }
}
```

### 2.2 重新处理文件分段

**接口**: `POST /api/files/reprocess`

**请求参数**:
```json
{
  "file_id": "string",
  "chunk_size": "number",    // 可选，分段大小
  "overlap": "number",       // 可选，重叠长度
  "regenerate_embeddings": "boolean"  // 是否重新生成embeddings
}
```

**响应数据**:
```json
{
  "file_id": "string",
  "chunks_count": "number",
  "processing_status": "completed|failed|processing"
}
```

## 3. 搜索与检索模块接口

### 3.1 语义搜索

**接口**: `POST /api/search/semantic`

**请求参数**:
```json
{
  "query": "string",
  "limit": "number",        // 默认 10
  "similarity_threshold": "number",  // 默认 0.7
  "file_types": ["string"], // 可选，文件类型筛选
  "categories": ["string"], // 可选，分类筛选
  "tags": ["string"]       // 可选，标签筛选
}
```

**响应数据**:
```json
{
  "results": [
    {
      "chunk_id": "string",
      "file_id": "string",
      "file_name": "string",
      "file_path": "string",
      "chunk_content": "string",
      "chunk_index": "number",
      "similarity_score": "number",
      "context": {
        "prev_chunk": "string",
        "next_chunk": "string"
      }
    }
  ],
  "search_metadata": {
    "query": "string",
    "total_results": "number",
    "search_time_ms": "number",
    "embedding_time_ms": "number"
  }
}
```

### 3.2 关键词搜索

**接口**: `POST /api/search/keyword`

**请求参数**:
```json
{
  "query": "string",
  "page": "number",        // 默认 1
  "limit": "number",       // 默认 20
  "file_types": ["string"], // 可选，文件类型筛选
  "categories": ["string"]  // 可选，分类筛选
}
```

**响应数据**:
```json
{
  "results": [
    {
      "file_id": "string",
      "file_name": "string",
      "file_path": "string",
      "file_type": "string",
      "category": "string",
      "matched_chunks": [
        {
          "chunk_id": "string",
          "content": "string",
          "chunk_index": "number",
          "highlight": "string"  // 高亮匹配文本
        }
      ],
      "relevance_score": "number"
    }
  ],
  "pagination": {
    "current_page": "number",
    "total_pages": "number",
    "total_count": "number",
    "limit": "number"
  }
}
```

## 4. 问答模块接口

### 4.1 智能问答

**接口**: `POST /api/chat/ask`

**请求参数**:
```json
{
  "question": "string",
  "context_limit": "number",     // 检索上下文数量，默认 5
  "temperature": "number",       // LLM 温度参数，默认 0.7
  "max_tokens": "number",        // 最大生成token数，默认 1000
  "stream": "boolean",          // 是否流式响应，默认 false
  "file_filters": {
    "file_ids": ["string"],     // 可选，指定文件范围
    "categories": ["string"],   // 可选，指定分类范围
    "tags": ["string"]         // 可选，指定标签范围
  }
}
```

**响应数据**:
```json
{
  "answer": "string",
  "confidence": "number",        // 答案置信度 0-1
  "sources": [
    {
      "file_id": "string",
      "file_name": "string",
      "file_path": "string",
      "chunk_id": "string",
      "chunk_content": "string",
      "chunk_index": "number",
      "relevance_score": "number"
    }
  ],
  "metadata": {
    "model_used": "string",
    "tokens_used": "number",
    "response_time_ms": "number",
    "retrieval_time_ms": "number",
    "generation_time_ms": "number"
  }
}
```

### 4.2 对话历史

**接口**: `POST /api/chat/history`

**请求参数**:
```json
{
  "page": "number",        // 默认 1
  "limit": "number",       // 默认 20
  "session_id": "string"   // 可选，指定会话ID
}
```

**响应数据**:
```json
{
  "conversations": [
    {
      "id": "string",
      "session_id": "string",
      "question": "string",
      "answer": "string",
      "sources_count": "number",
      "confidence": "number",
      "created_at": "string"
    }
  ],
  "pagination": {
    "current_page": "number",
    "total_pages": "number",
    "total_count": "number",
    "limit": "number"
  }
}
```

### 4.3 目录结构推荐

**接口**: `POST /api/chat/directory-structure`

**请求参数**:
```json
{
  "profession": "string",       // 职业，如 "软件工程师"、"设计师"、"教师"
  "purpose": "string",          // 文件夹用途，如 "项目管理"、"个人资料"、"学习资料"
  "min_directories": "number",  // 最少目录数量，默认 6
  "max_directories": "number",  // 最多目录数量，默认 20
  "temperature": "number",      // LLM 温度参数，默认 0.7
  "max_tokens": "number"        // 最大生成token数，默认 1000
}
```

**响应数据**:
```json
{
  "directories": [
    {
      "path": "string",          // 相对路径，如 "项目文档/需求分析"
      "description": "string"    // 用途说明
    }
  ],
  "metadata": {
    "model_used": "string",
    "tokens_used": "number",
    "response_time_ms": "number",
    "generation_time_ms": "number"
  }
}
```

### 4.4 推荐存放目录

**接口**: `POST /api/chat/recommend-directory`

**请求参数**:
```json
{
  "file_name": "string",        // 文件名称，如 "项目需求文档.pdf"
  "file_content": "string",     // 文件部分内容（前1000字符）
  "current_structure": [        // 可选，当前目录结构
    "string"
  ],
  "temperature": "number",      // LLM 温度参数，默认 0.7
  "max_tokens": "number"        // 最大生成token数，默认 500
}
```

**响应数据**:
```json
{
  "recommended_directory": "string",  // 推荐的目录路径，如 "项目文档/需求分析"
  "confidence": "number",             // 推荐置信度 0-1
  "reasoning": "string",              // 推荐理由
  "alternatives": [                   // 备选目录列表
    "string"
  ],
  "metadata": {
    "model_used": "string",
    "tokens_used": "number",
    "response_time_ms": "number",
    "generation_time_ms": "number"
  }
}
```

## 5. 系统管理接口

### 5.1 系统状态

**接口**: `GET /api/system/status`

**响应数据**:
```json
{
  "status": "healthy|degraded|unhealthy",
  "services": {
    "database": "connected|disconnected",
    "vector_db": "connected|disconnected",
    "embedding_model": "loaded|loading|error",
    "llm_model": "loaded|loading|error"
  },
  "statistics": {
    "total_files": "number",
    "total_chunks": "number",
    "total_embeddings": "number",
    "storage_used_mb": "number"
  },
  "version": "string",
  "uptime_seconds": "number"
}
```

### 5.2 系统配置

**接口**: `GET /api/system/config`

**响应数据**:
```json
{
  "embedding_model": "string",
  "llm_model": "string",
  "llm_type": "local|aliyun|openai|ollama|claude|custom",
  "llm_endpoint": "string",
  "llm_api_key": "string",
  "chunk_size": "number",
  "chunk_overlap": "number",
  "similarity_threshold": "number",
  "max_file_size_mb": "number",
  "supported_file_types": ["string"],
  "workdir_path": "string",
  "database_path": "string"
}
```

**字段说明**:
- `llm_type`: 大语言模型类型
  - `local`: 本地模型（如 Ollama）
  - `aliyun`: Aliyun API
  - `openai`: OpenAI API
  - `claude`: Anthropic Claude API
  - `ollama`: Ollama 服务
  - `custom`: 自定义 API
- `llm_endpoint`: 模型服务地址（如 `http://localhost:11434` 或 `https://api.openai.com/v1`）
- `llm_api_key`: API 密钥（如果需要的话）

### 5.3 更新系统配置

**接口**: `POST /api/system/config/update`

**请求参数**:
```json
{
  "llm_type": "local|openai|ollama|claude|custom",
  "llm_endpoint": "string",
  "llm_api_key": "string",
  "chunk_size": "number",
  "chunk_overlap": "number",
  "similarity_threshold": "number",
  "max_file_size_mb": "number"
}
```

**响应数据**:
```json
{
  "updated_config": {
    "llm_type": "local|openai|ollama|claude|custom",
    "llm_endpoint": "string",
    "llm_api_key": "string",
    "chunk_size": "number",
    "chunk_overlap": "number",
    "similarity_threshold": "number",
    "max_file_size_mb": "number"
  },
  "restart_required": "boolean"
}
```

## 错误代码规范

### 通用错误代码
- `INVALID_REQUEST`: 请求参数无效
- `RESOURCE_NOT_FOUND`: 资源不存在
- `INTERNAL_ERROR`: 服务器内部错误
- `RATE_LIMIT_EXCEEDED`: 请求频率超限

### 文件管理错误代码
- `FILE_NOT_FOUND`: 文件不存在
- `FILE_TOO_LARGE`: 文件过大
- `UNSUPPORTED_FILE_TYPE`: 不支持的文件类型
- `FILE_PROCESSING_FAILED`: 文件处理失败

### 搜索相关错误代码
- `EMBEDDING_GENERATION_FAILED`: Embedding 生成失败
- `VECTOR_DB_ERROR`: 向量数据库错误
- `SEARCH_TIMEOUT`: 搜索超时

### RAG 相关错误代码
- `LLM_NOT_AVAILABLE`: LLM 模型不可用
- `CONTEXT_TOO_LONG`: 上下文过长
- `GENERATION_FAILED`: 文本生成失败

## WebSocket 接口（实时功能）

### 文件处理进度推送

**连接**: `ws://localhost:8000/ws/processing`

**消息格式**:
```json
{
  "type": "file_processing_progress",
  "data": {
    "file_id": "string",
    "file_name": "string",
    "status": "processing|completed|failed",
    "progress": "number",  // 0-100
    "current_step": "string",
    "error_message": "string"  // 仅在失败时
  }
}
```

### 流式问答响应

**连接**: `ws://localhost:8000/ws/chat`

**消息格式**:
```json
{
  "type": "chat_response_chunk",
  "data": {
    "session_id": "string",
    "chunk": "string",
    "is_final": "boolean",
    "sources": [...],  // 仅在最后一个chunk中包含
    "metadata": {...}  // 仅在最后一个chunk中包含
  }
}
```
