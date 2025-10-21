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

export function buildQueryPurposeMessages(params: {
  language: SupportedLang;
  text: string;
  purposeOptions: readonly string[];
}): Message[] {
  const { language, text, purposeOptions } = params;
  const optionsList = purposeOptions.join(", ");

  if (language === "zh") {
    return [
      {
        role: "system",
        content:
          "你是一名查询意图识别助手。你需要判断用户输入文本的主要目的，只能在预定义选项中选择，并严格输出 JSON。",
      },
      {
        role: "user",
        content:
          `可选查询目的：${purposeOptions
            .map((opt) =>
              opt === "retrieval"
                ? "retrieval（用户希望检索资料或寻找信息）"
                : "summary（用户希望对已有内容进行总结）"
            )
            .join("；")}
输入文本：${text}
请返回 JSON：{\n  "purpose": "retrieval" | "summary",\n  "confidence": number,\n  "reasoning": string\n}\n注意：confidence 范围为 0 到 1；reasoning 用简短中文解释判断依据。`,
      },
    ];
  }

  return [
    {
      role: "system",
      content:
        "You are an intent classification assistant. Determine the user's primary goal and choose only from the predefined options. Always output strict JSON.",
    },
    {
      role: "user",
      content:
        `Available purposes: ${optionsList} (retrieval = user wants to look up information; summary = user wants a concise summary of provided content).
Input text: ${text}
Return JSON: {\n  "purpose": "retrieval" | "summary",\n  "confidence": number,\n  "reasoning": string\n}\nNotes: confidence must be between 0 and 1; reasoning should briefly justify the choice in English.`,
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

/** Build a localized prompt for image description. */
export function buildVisionDescribePrompt(
  language: SupportedLang,
  userHint?: string
): string {
  const hint = typeof userHint === "string" && userHint.trim() ? userHint.trim() : "";
  if (language === "zh") {
    return (
      (hint
        ? `请详细描述这张图片的内容。重点包括：主体对象、场景、颜色、文字（如有OCR可读文字请尽量描述）、情感氛围、可能的关键标签。附加指令：${hint}\n`
        : `请详细描述这张图片的内容。重点包括：主体对象、场景、颜色、文字（如有OCR可读文字请尽量描述）、情感氛围、可能的关键标签。\n`) +
      "输出使用中文。"
    );
  }
  return (
    (hint
      ? `Describe this image in detail. Focus on main objects, scene, colors, any visible text, mood, and potential tags. Additional instruction: ${hint}\n`
      : `Describe this image in detail. Focus on main objects, scene, colors, any visible text, mood, and potential tags.\n`) +
    "Output in English."
  );
}

/** Build messages for extracting keyword tags from a piece of text. */
export function buildExtractTagsMessages(params: {
  language: SupportedLang;
  text: string;
  topK?: number;
  domainHint?: string;
}): { role: "system" | "user"; content: string }[] {
  const { language, text } = params;
  const topK = Math.max(1, Math.min(50, Math.floor(params.topK ?? 10)));
  const hint = typeof params.domainHint === "string" && params.domainHint.trim() ? params.domainHint.trim() : "";

  if (language === "zh") {
    return [
      {
        role: "system",
        content:
          "你是一名信息抽取助手，请从输入文本中提取最能代表主题的关键标签（短语）。严格输出 JSON，仅包含字段 tags。要求：1) 标签简短清晰，以名词或名词短语为主；2) 不要包含标点或编号；3) 去重；4) 数量不超过指定上限；5) 尽量通用而非过度细碎。",
      },
      {
        role: "user",
        content:
          `标签上限：${topK}\n${hint ? `领域提示：${hint}\n` : ""}文本：\n${text}\n\n仅返回 JSON，例如：{\n  "tags": ["标签1", "标签2"]\n}`,
      },
    ];
  }

  return [
    {
      role: "system",
      content:
        "You are an information extraction assistant. Extract concise, representative keyword tags from the input. Output JSON only with field 'tags'. Rules: 1) short noun phrases; 2) no punctuation or numbering; 3) deduplicate; 4) do not exceed limit; 5) prefer broadly useful terms over overly specific ones.",
    },
    {
      role: "user",
      content:
        `Max tags: ${topK}\n${hint ? `Domain hint: ${hint}\n` : ""}Text:\n${text}\n\nReturn JSON only, e.g.: {\n  "tags": ["tag1", "tag2"]\n}`,
    },
  ];
}
