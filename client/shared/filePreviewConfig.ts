// Default list of file extensions allowed for preview (lowercase, without leading dot)
export const DEFAULT_SUPPORTED_PREVIEW_EXTENSIONS = [
  'txt',
  'md',
  'markdown',
  'mdx',
  'rst',
  'log',
  'json',
  'csv',
  'tsv',
  'xml',
  'yaml',
  'yml',
  'ini',
  'conf',
  'cfg',
  'env',
  'html',
  'htm',
  'xhtml',
  'css',
  'less',
  'scss',
  'sass',
  'js',
  'jsx',
  'ts',
  'tsx',
  'py',
  'java',
  'c',
  'cpp',
  'h',
  'hpp',
  'go',
  'rb',
  'php',
  'sql',
  'sh',
  'bat',
  'ps1',
  'swift',
  'kt',
  'kts',
  'rs',
  'lua',
  'tex',
  'properties',
  'pdf',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'bmp',
  'webp',
  'svg',
  'ico',
  'mp4',
  'm4v',
  'mov',
  'webm',
  'avi',
  'wmv',
  'flv',
  'mkv',
  'mpg',
  'mpeg'
] as const;

export type PreviewSupportedExtension = (typeof DEFAULT_SUPPORTED_PREVIEW_EXTENSIONS)[number];

function normalizeExtension(value: string): string {
  const trimmed = value.trim().toLowerCase().replace(/^\.+/, '');
  if (!trimmed) {
    return '';
  }
  const valid = /^[a-z0-9][a-z0-9._-]*$/.test(trimmed);
  return valid ? trimmed : '';
}

export function sanitizePreviewExtensions(
  value: unknown,
  fallback: readonly string[] = DEFAULT_SUPPORTED_PREVIEW_EXTENSIONS
): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  const append = (candidate: string) => {
    const normalized = normalizeExtension(candidate);
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    result.push(normalized);
  };

  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item !== 'string') {
        continue;
      }
      append(item);
    }
  }

  if (result.length === 0) {
    for (const fallbackItem of fallback) {
      append(fallbackItem);
    }
  }

  return result;
}

export function extractPreviewExtension(target: string): string {
  if (typeof target !== 'string' || !target.trim()) {
    return '';
  }
  const normalized = target.replace(/\\/g, '/');
  const segment = normalized.split('/').pop() ?? normalized;
  const dotIndex = segment.lastIndexOf('.');
  if (dotIndex <= 0 || dotIndex === segment.length - 1) {
    return '';
  }
  return segment.slice(dotIndex + 1).toLowerCase();
}

export function isPreviewExtensionSupported(extension: string, supported: Iterable<string>): boolean {
  const normalized = normalizeExtension(extension);
  if (!normalized) {
    return false;
  }
  for (const item of supported) {
    if (normalizeExtension(String(item)) === normalized) {
      return true;
    }
  }
  return false;
}

export function isPathPreviewSupported(pathOrName: string, supported: Iterable<string>): boolean {
  const ext = extractPreviewExtension(pathOrName);
  if (!ext) {
    return false;
  }
  return isPreviewExtensionSupported(ext, supported);
}
