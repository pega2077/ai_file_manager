/*
  Prompt helper utility to centralize and localize prompt templates.
  Supported languages: 'en' | 'zh'
*/

export type SupportedLang = "en" | "zh";

export function normalizeLanguage(input: unknown, fallback: SupportedLang = "en"): SupportedLang {
  if (typeof input !== "string") return fallback;
  const s = input.trim().toLowerCase();
  return s === "zh" || s === "zh-cn" || s === "zh_cn" || s === "cn" ? "zh" : "en";
}

type Message = { role: "system" | "user"; content: string };

export function buildRecommendDirectoryMessages(params: {
  language: SupportedLang;
  fileName: string;
  fileContent: string;
  currentStructure: string[];
}): Message[] {
  const { language, fileName, fileContent, currentStructure } = params;
  const structureStr = currentStructure.length > 0 ? currentStructure.join("\n") : "";

  if (language === "zh") {
    return [
      {
        role: "system",
        content:
          "你是一名文件分类专家。请根据文件名和部分内容，推荐最合适的存储目录。必须严格输出 JSON。",
      },
      {
        role: "user",
        content:
          `当前目录结构（每行一个，可能为空）：\n${structureStr}\n\n文件名：${fileName}\n文件内容（部分）：${fileContent}\n\n返回 JSON：{\n  "recommended_directory": string,\n  "confidence": number,\n  "reasoning": string,\n  "alternatives": string[]\n}`,
      },
    ];
  }

  // en
  return [
    {
      role: "system",
      content:
        "You are a file classification expert. Recommend the best directory to store the file based on its name and partial content. Output JSON strictly.",
    },
    {
      role: "user",
      content:
        `Current structure (one per line, may be empty):\n${structureStr}\n\nFile name: ${fileName}\nFile content (partial): ${fileContent}\n\nReturn JSON: {\n  "recommended_directory": string,\n  "confidence": number,\n  "reasoning": string,\n  "alternatives": string[]\n}`,
    },
  ];
}

export function buildDirectoryStructureMessages(params: {
  language: SupportedLang;
  profession: string;
  purpose: string;
  folderDepth: number;
  minDirectories: number;
  maxDirectories: number;
}): Message[] {
  const { language, profession, purpose, folderDepth, minDirectories, maxDirectories } = params;

  if (language === "zh") {
    return [
      {
        role: "system",
        content:
          "你是一个擅长为不同职业设计、可维护并易于扩展的文件夹/目录结构的助手。输出必须严格符合给定的 JSON Schema。",
      },
      {
        role: "user",
        content:
          `请根据下面输入参数，返回一个推荐的、便于长期维护的目录结构。输出必须仅为 JSON 字符串，不要额外文字。职业：${profession}\n目标：${purpose}\n\n请提出一个清晰的目录结构，总目录数量在 ${minDirectories} 到 ${maxDirectories} 之间，目录风格扁平化。\n重点是帮助整理文档的实际可用性。\n返回`,
      },
    ];
  }

  // en
  return [
    {
      role: "system",
      content:
        "You are a helpful assistant that designs practical, hierarchical directory structures. Output strictly valid JSON only.",
    },
    {
      role: "user",
      content:
        `Profession: ${profession}\nPurpose: ${purpose}\n\nPlease propose a clear directory structure with between ${minDirectories} and ${maxDirectories} directories (flat or hierarchical using '/' to indicate subfolders).Max folder depth: ${folderDepth}.\nFocus on real-world usefulness for organizing documents.\nReturn JSON: {\n  "directories": string[],\n  "metadata": {\n    "description": string\n  }\n}`,
    },
  ];
}

export function buildChatAskMessages(params: {
  question: string;
  contextStr: string;
  language?: SupportedLang;
}): Message[] {
  const { question, contextStr, language } = params;
  if (language === "zh") {
    return [
      { role: "system", content: "你是一个基于提供上下文准确回答问题的助手。如果上下文没有答案，请说明不确定。仅输出 JSON。" },
      { role: "user", content: `问题：${question}\n\n上下文：\n${contextStr}\n\n返回 JSON：{\n  "answer": string,\n  "confidence": number\n}` },
    ];
  }
  return [
    { role: "system", content: "You are a helpful assistant that answers questions using provided context accurately. If the answer is not in the context, say you are not sure. Output JSON only." },
    { role: "user", content: `Question: ${question}\n\nContext:\n${contextStr}\n\nReturn JSON: {\n  "answer": string,\n  "confidence": number\n}` },
  ];
}
