import FileModel from "../models/file";
import { logger } from "../../logger";
import { configManager } from "../../configManager";

/**
 * Tag Service - Handles tag organization with synonym checking
 * 
 * Features:
 * - Manages preset tag library from configuration
 * - Queries existing tags from database
 * - Merges and caches tag library
 * - Performs synonym checking for new tags using Levenshtein distance
 */

interface TagCacheEntry {
  tags: string[];
  timestamp: number;
}

/**
 * Calculate Levenshtein distance between two strings
 * Used for fuzzy string matching to detect similar tags
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  // Initialize matrix
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  // Calculate distances
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Calculate similarity score between two strings (0-1, 1 being identical)
 */
function stringSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const distance = levenshteinDistance(a, b);
  return 1 - distance / maxLen;
}

class TagService {
  private cache: TagCacheEntry | null = null;
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes cache
  private readonly SIMILARITY_THRESHOLD = 0.8; // 80% similarity threshold for synonym matching

  /**
   * Get preset tags from configuration
   */
  private getPresetTags(): string[] {
    const config = configManager.getConfig();
    const presetTags = config.presetTags || [];
    
    // Validate and normalize preset tags
    return presetTags
      .filter(tag => typeof tag === 'string' && tag.trim().length > 0)
      .map(tag => tag.trim());
  }

  /**
   * Query all unique tags from database
   */
  private async getDatabaseTags(): Promise<string[]> {
    try {
      const files = await FileModel.findAll({
        attributes: ['tags'],
        raw: true,
      });

      const tagSet = new Set<string>();
      
      files.forEach((file: { tags: string | null }) => {
        if (file.tags) {
          try {
            const tags = JSON.parse(file.tags) as unknown;
            if (Array.isArray(tags)) {
              tags.forEach((tag: unknown) => {
                if (typeof tag === 'string' && tag.trim().length > 0) {
                  tagSet.add(tag.trim());
                }
              });
            }
          } catch (err) {
            logger.warn('Failed to parse tags from database', { tags: file.tags, error: String(err) });
          }
        }
      });

      return Array.from(tagSet);
    } catch (err) {
      logger.error('Failed to query tags from database', err as unknown);
      return [];
    }
  }

  /**
   * Merge preset tags and database tags, removing duplicates
   */
  private mergeTags(presetTags: string[], databaseTags: string[]): string[] {
    const tagMap = new Map<string, string>();
    
    // Add preset tags first (they have priority)
    presetTags.forEach(tag => {
      const normalized = tag.toLowerCase();
      if (!tagMap.has(normalized)) {
        tagMap.set(normalized, tag);
      }
    });
    
    // Add database tags if not already present (case-insensitive check)
    databaseTags.forEach(tag => {
      const normalized = tag.toLowerCase();
      if (!tagMap.has(normalized)) {
        tagMap.set(normalized, tag);
      }
    });
    
    return Array.from(tagMap.values()).sort();
  }

  /**
   * Get or build the merged tag library with caching
   */
  async getTagLibrary(forceRefresh = false): Promise<string[]> {
    const now = Date.now();
    
    // Return cached result if valid
    if (!forceRefresh && this.cache && (now - this.cache.timestamp) < this.CACHE_TTL_MS) {
      return this.cache.tags;
    }

    // Build new tag library
    const presetTags = this.getPresetTags();
    const databaseTags = await this.getDatabaseTags();
    const mergedTags = this.mergeTags(presetTags, databaseTags);
    
    // Update cache
    this.cache = {
      tags: mergedTags,
      timestamp: now,
    };
    
    logger.info('Tag library updated', {
      presetCount: presetTags.length,
      databaseCount: databaseTags.length,
      totalCount: mergedTags.length,
    });
    
    return mergedTags;
  }

  /**
   * Find the best matching tag from the library using synonym checking
   * Returns the existing tag if a close match is found, otherwise returns the input tag
   */
  async findSynonymTag(inputTag: string): Promise<string> {
    if (!inputTag || typeof inputTag !== 'string') {
      return inputTag;
    }

    const normalizedInput = inputTag.trim();
    if (normalizedInput.length === 0) {
      return inputTag;
    }

    const tagLibrary = await this.getTagLibrary();
    
    // Exact match (case-insensitive)
    const exactMatch = tagLibrary.find(
      tag => tag.toLowerCase() === normalizedInput.toLowerCase()
    );
    if (exactMatch) {
      return exactMatch;
    }

    // Find best similarity match
    let bestMatch = normalizedInput;
    let bestScore = 0;

    tagLibrary.forEach(tag => {
      const score = stringSimilarity(normalizedInput.toLowerCase(), tag.toLowerCase());
      if (score > bestScore && score >= this.SIMILARITY_THRESHOLD) {
        bestScore = score;
        bestMatch = tag;
      }
    });

    if (bestScore >= this.SIMILARITY_THRESHOLD) {
      logger.info('Synonym match found', {
        input: normalizedInput,
        match: bestMatch,
        score: bestScore.toFixed(3),
      });
    }

    return bestMatch;
  }

  /**
   * Normalize a list of tags by checking for synonyms in the tag library
   * Returns a deduplicated list where new tags are replaced with existing ones if synonyms are found
   */
  async normalizeTags(inputTags: string[]): Promise<string[]> {
    if (!Array.isArray(inputTags)) {
      return [];
    }

    const normalizedTags: string[] = [];
    const seenTags = new Set<string>();

    for (const tag of inputTags) {
      if (typeof tag !== 'string' || tag.trim().length === 0) {
        continue;
      }

      const normalizedTag = await this.findSynonymTag(tag);
      const key = normalizedTag.toLowerCase();
      
      if (!seenTags.has(key)) {
        seenTags.add(key);
        normalizedTags.push(normalizedTag);
      }
    }

    return normalizedTags;
  }

  /**
   * Clear the tag library cache
   */
  clearCache(): void {
    this.cache = null;
    logger.info('Tag library cache cleared');
  }

  /**
   * Get cache status
   */
  getCacheStatus(): { cached: boolean; age?: number; count?: number } {
    if (!this.cache) {
      return { cached: false };
    }

    return {
      cached: true,
      age: Date.now() - this.cache.timestamp,
      count: this.cache.tags.length,
    };
  }
}

// Export singleton instance
export const tagService = new TagService();
