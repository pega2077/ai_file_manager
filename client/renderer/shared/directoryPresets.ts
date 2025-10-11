import enPresetsData from './directory-presets.en.json';
import zhPresetsData from './directory-presets.zh.json';

export type DirectoryStyle = 'flat' | 'hierarchical';

export interface DirectoryStructureEntry {
  path: string;
  description: string;
}

interface DirectoryPresetConfig {
  id: string;
  languages: string[];
  style: DirectoryStyle;
  professionKeywords: string[];
  purposeKeywords: string[];
  directories: DirectoryStructureEntry[];
}

interface DirectoryPresetCriteria {
  profession: string;
  purpose: string;
  style: DirectoryStyle;
  language: string;
}

const presets = [
  ...(enPresetsData as DirectoryPresetConfig[]),
  ...(zhPresetsData as DirectoryPresetConfig[]),
];

const normalizeText = (value: string): string =>
  value
    .toLocaleLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const normalizeLanguage = (value: string): string => {
  const normalized = value.toLocaleLowerCase().replace(/_/g, '-');
  const [primary, secondary] = normalized.split('-', 2);
  if (!secondary) {
    return primary;
  }
  // Preserve full tag when present in presets, otherwise fall back to primary language code.
  return presets.some((preset) =>
    preset.languages.some((lang) => lang.toLocaleLowerCase() === normalized)
  )
    ? normalized
    : primary;
};

const matchesKeywords = (input: string, keywords: string[]): boolean => {
  if (!input || keywords.length === 0) {
    return false;
  }
  const normalizedInput = normalizeText(input);
  return keywords.some((keyword) => {
    const normalizedKeyword = normalizeText(keyword);
    return (
      normalizedInput.includes(normalizedKeyword) ||
      normalizedKeyword.includes(normalizedInput)
    );
  });
};

export const findDirectoryStructurePreset = (
  criteria: DirectoryPresetCriteria
): DirectoryStructureEntry[] | null => {
  const normalizedLanguage = normalizeLanguage(criteria.language);
  const normalizedProfession = normalizeText(criteria.profession);
  const normalizedPurpose = normalizeText(criteria.purpose);

  for (const preset of presets) {
    const languageMatch = preset.languages.some((lang) => {
      const normalizedPresetLang = normalizeLanguage(lang);
      return (
        normalizedPresetLang === normalizedLanguage ||
        normalizedPresetLang === normalizeLanguage('any') ||
        normalizedPresetLang === 'any'
      );
    });

    if (!languageMatch) {
      continue;
    }

    if (preset.style !== criteria.style) {
      continue;
    }

    const professionMatch = matchesKeywords(normalizedProfession, preset.professionKeywords);
    const purposeMatch = matchesKeywords(normalizedPurpose, preset.purposeKeywords);

    if (professionMatch && purposeMatch) {
      return preset.directories;
    }
  }

  return null;
};
