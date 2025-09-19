// 文本文件扩展名列表
export const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.rst', '.json', '.xml', '.yaml', '.yml']);

/**
 * 检查是否是文本文件
 * @param filePath 文件路径
 * @returns 是否为文本文件
 */
export const isTextFile = (filePath: string): boolean => {
  const extension = filePath.toLowerCase().substring(filePath.lastIndexOf('.'));
  return TEXT_EXTENSIONS.has(extension);
};