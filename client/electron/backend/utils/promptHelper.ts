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

export type DirectoryStyle = "flat" | "hierarchical";

export function normalizeDirectoryStyle(
  input: unknown,
  fallback: DirectoryStyle = "flat"
): DirectoryStyle {
  if (typeof input !== "string") return fallback;
  const s = input.trim().toLowerCase();
  if (
    s === "flat" ||
    s === "flat-style" ||
    s === "flat_style" ||
    s === "扁平" ||
    s === "扁平风格" ||
    s === "平铺"
  )
    return "flat";
  if (
    s === "hierarchical" ||
    s === "multi-level" ||
    s === "multilevel" ||
    s === "多层级" ||
    s === "多层级风格" ||
    s === "层级"
  )
    return "hierarchical";
  return fallback;
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
  style: DirectoryStyle;
}): Message[] {
  const { language, profession, purpose, folderDepth, minDirectories, maxDirectories, style } = params;

  if (language === "zh") {
    return [
      {
        role: "system",
        content:
          "你是一个擅长为不同职业设计、可维护并易于扩展的文件夹/目录结构的助手。输出必须严格符合给定的 JSON Schema。",
      },
      {
        role: "user",
        content: (() => {
          const styleHint =
            style === "flat"
              ? "目录风格保持扁平化，尽量避免子目录。"
              : "可以适当增加子目录，目录结构这样表示（目录/子目录），但不要超过最大层级。";
          return (
            `请根据下面输入参数，返回一个推荐的、便于长期维护的目录结构。输出必须仅为 JSON 字符串，不要额外文字。\n` +
            `职业：${profession}\n` +
            `目标：${purpose}\n` +
            `目录风格：${style === "flat" ? "扁平风格" : "多层级风格"}。${styleHint}\n` +
            `最大目录层级：${folderDepth}。总目录数量在 ${minDirectories} 到 ${maxDirectories} 之间。\n` +
            `返回 JSON 必须符合以下结构：{\n  "directories": [\n    { "path": string, "description": string }\n  ]\n}\n` +
            `注意：\n- 路径使用'/'分隔子目录，例如 "文档/项目"。\n- 每个条目的 path 与 description 都必须为字符串。\n- 只输出 JSON，不要任何额外文本。`
          );
        })(),
      },
    ];
  }

  // en
  return [
    {
      role: "system",
      content:
        "You are a helpful assistant that designs practical, maintainable directory structures. Output strictly valid JSON only.",
    },
    {
      role: "user",
      content: (() => {
        const styleHint =
          style === "flat"
            ? "Keep the structure flat and avoid subfolders."
            : "You may introduce subfolders using '/' (e.g., 'Folder/Subfolder'), but do not exceed the max depth.";
        return (
          `Profession: ${profession}\n` +
          `Purpose: ${purpose}\n` +
          `Directory style: ${style === "flat" ? "flat" : "hierarchical"}. ${styleHint}\n` +
          `Max folder depth: ${folderDepth}. Total directories between ${minDirectories} and ${maxDirectories}.\n` +
          `Return JSON with the following schema only:\n{\n  "directories": [\n    { "path": string, "description": string }\n  ]\n}\n` +
          `Notes:\n- Use '/' to indicate subfolders.\n- Both 'path' and 'description' must be strings.\n- Output JSON only, no extra text.`
        );
      })(),
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
