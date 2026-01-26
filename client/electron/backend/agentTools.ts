import { logger } from "../logger";
import { configManager } from "../configManager";
import { httpGetJson, httpPostJson } from "./utils/httpClient";

/**
 * Type definitions for agent tools
 */
export type AgentToolCall = {
  name: string;
  parameters: Record<string, unknown>;
};

export type AgentExecutionStep = {
  type: "planning" | "tool_execution" | "complete" | "error";
  message: string;
  tool?: string;
  parameters?: Record<string, unknown>;
  result?: unknown;
  timestamp: string;
};

export type AgentToolParameter = {
  name: string;
  type: "string" | "number" | "boolean" | "object" | "array";
  description: {
    en: string;
    zh: string;
  };
  required: boolean;
  example?: unknown;
};

export type AgentTool = {
  name: string;
  display_name: {
    en: string;
    zh: string;
  };
  description: {
    en: string;
    zh: string;
  };
  parameters: AgentToolParameter[];
  execute: (params: Record<string, unknown>) => Promise<unknown>;
};

/**
 * Helper to make API calls to local backend
 */
async function callLocalAPI(method: "GET" | "POST", endpoint: string, data?: unknown): Promise<unknown> {
  const config = configManager.getConfig();
  const host = config.localServiceHost || "127.0.0.1";
  const port = config.localServicePort || 8000;
  const baseUrl = `http://${host}:${port}`;
  const url = `${baseUrl}${endpoint}`;
  const timeoutMs = 60000; // 60 second timeout for tool execution
  
  try {
    if (method === "GET") {
      const response = await httpGetJson(url, undefined, timeoutMs);
      if (!response.ok) {
        throw new Error(`API call failed: ${method} ${endpoint} - ${response.error?.message || 'Unknown error'}`);
      }
      return response.data;
    } else {
      const response = await httpPostJson(url, data, undefined, timeoutMs);
      if (!response.ok) {
        throw new Error(`API call failed: ${method} ${endpoint} - ${response.error?.message || 'Unknown error'}`);
      }
      return response.data;
    }
  } catch (error) {
    logger.error(`API call failed: ${method} ${endpoint}`, error);
    throw error;
  }
}

/**
 * Define all available agent tools
 */
export const agentTools: AgentTool[] = [
  // File Import Tool
  {
    name: "import_file",
    display_name: {
      en: "Import File",
      zh: "导入文件",
    },
    description: {
      en: "Import a file into the system for processing, classification, and analysis",
      zh: "导入文件到系统中进行处理、分类和分析",
    },
    parameters: [
      {
        name: "file_path",
        type: "string",
        description: {
          en: "Absolute path to the file to import",
          zh: "要导入的文件的绝对路径",
        },
        required: true,
        example: "/path/to/document.pdf",
      },
      {
        name: "auto_process",
        type: "boolean",
        description: {
          en: "Whether to automatically process the file (classification, summary, embedding)",
          zh: "是否自动处理文件（分类、摘要、向量化）",
        },
        required: false,
        example: true,
      },
    ],
    execute: async (params) => {
      const result = await callLocalAPI("POST", "/api/files/import", params);
      return result;
    },
  },

  // File List Tool
  {
    name: "list_files",
    display_name: {
      en: "List Files",
      zh: "列出文件",
    },
    description: {
      en: "Get a list of files in the system with optional filtering",
      zh: "获取系统中的文件列表，支持过滤",
    },
    parameters: [
      {
        name: "category",
        type: "string",
        description: {
          en: "Filter by category",
          zh: "按分类过滤",
        },
        required: false,
      },
      {
        name: "tags",
        type: "array",
        description: {
          en: "Filter by tags",
          zh: "按标签过滤",
        },
        required: false,
      },
      {
        name: "limit",
        type: "number",
        description: {
          en: "Maximum number of files to return",
          zh: "返回的最大文件数",
        },
        required: false,
        example: 10,
      },
    ],
    execute: async (params) => {
      const result = await callLocalAPI("POST", "/api/files/list", params);
      return result;
    },
  },

  // File Conversion Tool
  {
    name: "convert_file",
    display_name: {
      en: "Convert File Format",
      zh: "转换文件格式",
    },
    description: {
      en: "Convert a file from one format to another (e.g., PDF to Markdown)",
      zh: "将文件从一种格式转换为另一种格式（如PDF转Markdown）",
    },
    parameters: [
      {
        name: "file_path",
        type: "string",
        description: {
          en: "Path to the file to convert",
          zh: "要转换的文件路径",
        },
        required: true,
      },
      {
        name: "target_format",
        type: "string",
        description: {
          en: "Target format (markdown, txt, etc.)",
          zh: "目标格式（markdown、txt等）",
        },
        required: true,
        example: "markdown",
      },
    ],
    execute: async (params) => {
      const result = await callLocalAPI("POST", "/api/files/convert", params);
      return result;
    },
  },

  // Extract Tags Tool
  {
    name: "extract_tags",
    display_name: {
      en: "Extract Tags",
      zh: "提取标签",
    },
    description: {
      en: "Use AI to extract relevant tags from file content",
      zh: "使用AI从文件内容中提取相关标签",
    },
    parameters: [
      {
        name: "file_id",
        type: "string",
        description: {
          en: "ID of the file to extract tags from",
          zh: "要提取标签的文件ID",
        },
        required: false,
      },
      {
        name: "text",
        type: "string",
        description: {
          en: "Text content to extract tags from (if no file_id provided)",
          zh: "要提取标签的文本内容（如果未提供file_id）",
        },
        required: false,
      },
      {
        name: "save_to_file",
        type: "boolean",
        description: {
          en: "Whether to save extracted tags to the file record",
          zh: "是否将提取的标签保存到文件记录",
        },
        required: false,
        example: true,
      },
    ],
    execute: async (params) => {
      const result = await callLocalAPI("POST", "/api/files/extract-tags", params);
      return result;
    },
  },

  // Image Recognition Tool
  {
    name: "describe_image",
    display_name: {
      en: "Describe Image",
      zh: "识别图像",
    },
    description: {
      en: "Use AI vision model to analyze and describe image content",
      zh: "使用AI视觉模型分析并描述图像内容",
    },
    parameters: [
      {
        name: "image_path",
        type: "string",
        description: {
          en: "Path to the image file",
          zh: "图像文件路径",
        },
        required: false,
      },
      {
        name: "image_base64",
        type: "string",
        description: {
          en: "Base64 encoded image data",
          zh: "Base64编码的图像数据",
        },
        required: false,
      },
      {
        name: "prompt",
        type: "string",
        description: {
          en: "Optional custom prompt for image analysis",
          zh: "可选的自定义图像分析提示",
        },
        required: false,
      },
    ],
    execute: async (params) => {
      const result = await callLocalAPI("POST", "/api/chat/describe-image", params);
      return result;
    },
  },

  // Semantic Search Tool
  {
    name: "semantic_search",
    display_name: {
      en: "Semantic Search",
      zh: "语义搜索",
    },
    description: {
      en: "Search for files using semantic/vector-based search",
      zh: "使用语义/向量搜索查找文件",
    },
    parameters: [
      {
        name: "query",
        type: "string",
        description: {
          en: "Search query text",
          zh: "搜索查询文本",
        },
        required: true,
        example: "machine learning papers",
      },
      {
        name: "top_k",
        type: "number",
        description: {
          en: "Number of results to return",
          zh: "返回的结果数量",
        },
        required: false,
        example: 5,
      },
    ],
    execute: async (params) => {
      const result = await callLocalAPI("POST", "/api/search/semantic", params);
      return result;
    },
  },

  // Recommend Directory Tool
  {
    name: "recommend_directory",
    display_name: {
      en: "Recommend Directory",
      zh: "推荐目录",
    },
    description: {
      en: "Get AI recommendations for where to save a file based on its content",
      zh: "根据文件内容获取AI推荐的保存位置",
    },
    parameters: [
      {
        name: "file_name",
        type: "string",
        description: {
          en: "Name of the file",
          zh: "文件名称",
        },
        required: false,
      },
      {
        name: "file_content",
        type: "string",
        description: {
          en: "Content of the file",
          zh: "文件内容",
        },
        required: false,
      },
    ],
    execute: async (params) => {
      const result = await callLocalAPI("POST", "/api/files/recommend-directory", params);
      return result;
    },
  },

  // RAG Q&A Tool
  {
    name: "ask_question",
    display_name: {
      en: "Ask Question",
      zh: "智能问答",
    },
    description: {
      en: "Ask questions about files using RAG (Retrieval Augmented Generation)",
      zh: "使用RAG（检索增强生成）对文件内容进行智能问答",
    },
    parameters: [
      {
        name: "question",
        type: "string",
        description: {
          en: "Question to ask about the files",
          zh: "关于文件的问题",
        },
        required: true,
        example: "What is the main topic of the documents?",
      },
      {
        name: "file_ids",
        type: "array",
        description: {
          en: "Optional list of specific file IDs to query",
          zh: "可选的特定文件ID列表",
        },
        required: false,
      },
    ],
    execute: async (params) => {
      const result = await callLocalAPI("POST", "/api/chat/ask", params);
      return result;
    },
  },

  // Update File Tags Tool
  {
    name: "update_file_tags",
    display_name: {
      en: "Update File Tags",
      zh: "更新文件标签",
    },
    description: {
      en: "Update or add tags to a file",
      zh: "更新或添加文件标签",
    },
    parameters: [
      {
        name: "file_id",
        type: "string",
        description: {
          en: "ID of the file to update",
          zh: "要更新的文件ID",
        },
        required: true,
      },
      {
        name: "tags",
        type: "array",
        description: {
          en: "Array of tags to set",
          zh: "要设置的标签数组",
        },
        required: true,
        example: ["important", "work", "2024"],
      },
    ],
    execute: async (params) => {
      const result = await callLocalAPI("POST", "/api/files/update-tags", params);
      return result;
    },
  },

  // List Directory Tool
  {
    name: "list_directory",
    display_name: {
      en: "List Directory",
      zh: "列出目录",
    },
    description: {
      en: "List files and folders in a directory",
      zh: "列出目录中的文件和文件夹",
    },
    parameters: [
      {
        name: "path",
        type: "string",
        description: {
          en: "Directory path to list",
          zh: "要列出的目录路径",
        },
        required: true,
        example: "/Users/username/Documents",
      },
      {
        name: "recursive",
        type: "boolean",
        description: {
          en: "Whether to list recursively",
          zh: "是否递归列出",
        },
        required: false,
        example: false,
      },
    ],
    execute: async (params) => {
      const endpoint = params.recursive ? "/api/files/list-directory-recursive" : "/api/files/list-directory";
      const result = await callLocalAPI("POST", endpoint, params);
      return result;
    },
  },

  // Get File Details Tool
  {
    name: "get_file_details",
    display_name: {
      en: "Get File Details",
      zh: "获取文件详情",
    },
    description: {
      en: "Get detailed information about a specific file",
      zh: "获取特定文件的详细信息",
    },
    parameters: [
      {
        name: "file_id",
        type: "string",
        description: {
          en: "ID of the file",
          zh: "文件ID",
        },
        required: true,
      },
    ],
    execute: async (params) => {
      const result = await callLocalAPI("GET", `/api/files/${params.file_id}`, undefined);
      return result;
    },
  },
];
