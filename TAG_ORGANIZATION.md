# Tag Organization with Synonym Checking

## Overview

This feature implements intelligent tag organization for file management using synonym checking. When tags are generated or updated, the system automatically checks against a merged tag library (preset tags + database tags) to maintain consistency and reduce duplicate tags with similar meanings.

## Features

### 1. Preset Tag Library Configuration

Users can configure a preset tag library in the application configuration (`config.json`):

```json
{
  "presetTags": [
    "工作", "学习", "项目", "会议", "报告", "总结",
    "图片", "视频", "音频", "文档", "演示",
    "重要", "紧急", "参考", "归档", "草稿",
    "技术", "设计", "营销", "财务", "法律"
  ]
}
```

### 2. Tag Library Merging and Caching

The tag service automatically:
- Loads preset tags from configuration
- Queries all unique tags from the database
- Merges them into a unified tag library (preset tags have priority)
- Caches the merged library for 5 minutes to improve performance

### 3. Synonym Checking Algorithm

When new tags are generated or updated, the system:
1. **Exact Match Check**: First checks for case-insensitive exact matches
2. **Similarity Matching**: Uses Levenshtein distance algorithm to find similar tags
3. **Threshold-based Replacement**: If similarity score >= 80%, replaces the new tag with the existing one

**Example:**
- New tag: "報告" → Matches preset tag: "报告" (80%+ similarity)
- New tag: "技朮" → Matches preset tag: "技术" (80%+ similarity)
- New tag: "会谈" → Matches preset tag: "会议" (if similarity >= 80%)

### 4. Automatic Integration

Synonym checking is automatically applied:
- When files are imported and auto-tagged
- When users manually update file tags via API
- Tags are normalized before being saved to the database

## API Endpoints

### GET /api/tags/library

Get the merged tag library (preset tags + database tags).

**Query Parameters:**
- `refresh` (optional): Set to `true` to force refresh the cache

**Response:**
```json
{
  "success": true,
  "message": "ok",
  "data": {
    "tags": ["工作", "学习", "项目", ...],
    "count": 20
  },
  "error": null,
  "timestamp": "2025-11-15T08:20:11.097Z",
  "request_id": ""
}
```

### POST /api/tags/normalize

Normalize a list of tags using synonym checking.

**Request Body:**
```json
{
  "tags": ["報告", "学习资料", "技朮文档"]
}
```

**Response:**
```json
{
  "success": true,
  "message": "ok",
  "data": {
    "original": ["報告", "学习资料", "技朮文档"],
    "normalized": ["报告", "学习", "技术"]
  },
  "error": null,
  "timestamp": "2025-11-15T08:20:11.097Z",
  "request_id": ""
}
```

### POST /api/tags/cache/clear

Clear the tag library cache to force a refresh on the next request.

**Response:**
```json
{
  "success": true,
  "message": "ok",
  "data": {
    "message": "Tag cache cleared successfully"
  },
  "error": null,
  "timestamp": "2025-11-15T08:20:11.097Z",
  "request_id": ""
}
```

### GET /api/tags/cache/status

Get the current status of the tag library cache.

**Response:**
```json
{
  "success": true,
  "message": "ok",
  "data": {
    "cached": true,
    "age": 125000,
    "count": 35
  },
  "error": null,
  "timestamp": "2025-11-15T08:20:11.097Z",
  "request_id": ""
}
```

## Configuration

Add preset tags to your `config.json`:

```json
{
  "presetTags": [
    // Your custom preset tags here
    "tag1",
    "tag2",
    "tag3"
  ],
  "autoTagEnabled": true,
  "tagSummaryMaxLength": 1000
}
```

## Implementation Details

### Tag Service (`tagService.ts`)

The core service handles:
- **Tag Library Management**: Merges preset and database tags
- **Caching**: 5-minute TTL cache to reduce database queries
- **Similarity Matching**: Levenshtein distance with 80% threshold
- **Normalization**: Deduplication and synonym replacement

### Integration Points

1. **File Import** (`saveFileHandler`): Tags are normalized after LLM extraction
2. **Tag Update** (`updateFileHandler`): Manual tag updates are normalized
3. **API Endpoints**: Direct access to tag operations

## Performance Considerations

- **Cache TTL**: 5 minutes (configurable in code)
- **Similarity Threshold**: 80% (configurable in code)
- **Algorithm Complexity**: O(n*m) for Levenshtein distance where n and m are string lengths

## Future Enhancements

Possible improvements:
1. User-configurable similarity threshold
2. Support for multi-language synonym dictionaries
3. Tag usage statistics and recommendations
4. Automatic tag merging suggestions
5. Integration with external thesaurus APIs
