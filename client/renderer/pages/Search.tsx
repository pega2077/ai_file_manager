import { useState, useEffect } from 'react';
import { Layout, Input, Button, List, Spin, message, Tag, Card, Modal, Slider, InputNumber, Checkbox, Space, Empty } from 'antd';
import { QuestionCircleOutlined, EyeOutlined, FolderOpenOutlined } from '@ant-design/icons';
import { useSearchParams } from 'react-router-dom';
import { apiService, ChatSearchResultItem, ChatSearchMetadata, QuestionResponse, ChatSearchResponse } from '../services/api';
import Sidebar from '../components/Sidebar';
import { useTranslation } from '../shared/i18n/I18nProvider';

const { Content } = Layout;
const { Search } = Input;

interface SearchResult {
  file_id: string;
  file_name: string;
  file_path: string;
  file_type: string;
  category: string;
  size: number;
  created_at: string;
  tags: string[];
}

// Filename search removed; SearchResponse no longer needed

interface ChunkContent {
  id: string;
  file_id: string;
  chunk_index: number;
  content: string;
  content_type: string;
  char_count: number;
  token_count: number;
  embedding_id: string;
  created_at: string;
  file_name: string;
  file_path: string;
}

const SearchPage = () => {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const selectedMenu = 'search';
  // Filename search removed

  // 提问相关状态
  const [questionQuery, setQuestionQuery] = useState('');
  const [questionResult, setQuestionResult] = useState<QuestionResponse | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<ChatSearchResultItem[]>([]);
  const [selectedChunkIds, setSelectedChunkIds] = useState<number[]>([]);
  const [retrievalMode, setRetrievalMode] = useState<'keyword' | 'vector' | 'none' | 'manual'>('none');
  const [searchMetadata, setSearchMetadata] = useState<ChatSearchMetadata | null>(null);
  const [referencedFiles, setReferencedFiles] = useState<SearchResult[]>([]);
  const [similarityThreshold, setSimilarityThreshold] = useState(0.4);
  const [contextLimit, setContextLimit] = useState(5);
  const [maxTokens, setMaxTokens] = useState(1000);
  const [temperature, setTemperature] = useState(0.7);

  // Tabs removed; QA view only

  // 分段预览状态
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewChunk, setPreviewChunk] = useState<ChunkContent | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // 处理URL参数中的引用文件
  useEffect(() => {
    const type = searchParams.get('type');
    const fileIdsParam = searchParams.get('fileIds');

    if (type === 'qa' && fileIdsParam) {
      const fileIds = fileIdsParam.split(',').filter(id => id && id.trim());
      console.log('Referenced fileIds from URL:', fileIds);
      // 通过接口获取文件信息
      const loadReferencedFiles = async () => {
        try {
          const files: SearchResult[] = [];
          for (const fileId of fileIds) {
            if (!fileId || !fileId.trim()) {
              console.warn('Skipping empty fileId:', fileId);
              continue;
            }
            const response = await apiService.getFileDetail(fileId.trim());
            if (response.success && response.data) {
              const fileData = response.data as {
                id?: string;
                file_id?: string;
                name: string;
                path: string;
                type: string;
                category: string;
                size: number;
                created_at: string;
                tags?: string[];
              };
              
              const actualFileId = fileData.file_id || fileData.id;
              if (!actualFileId) {
                console.warn('File data missing id or file_id:', fileData);
                continue;
              }
              
              files.push({
                file_id: actualFileId,
                file_name: fileData.name,
                file_path: fileData.path,
                file_type: fileData.type,
                category: fileData.category,
                size: fileData.size,
                created_at: fileData.created_at,
                tags: fileData.tags || []
              });
            }
          }
          setReferencedFiles(files);
        } catch (error) {
          console.error('Failed to load referenced files:', error);
          message.error(t('search.messages.loadReferencedFilesFailed'));
        }
      };

      loadReferencedFiles();
    }
  }, [searchParams, t]);

  // Filename search removed

  const handleSearchCandidates = async (value: string) => {
    const query = value.trim();
    if (!query) {
      message.warning(t('search.messages.emptyQuestion'));
      return;
    }

    setQuestionQuery(value);
    setQuestionResult(null);
    setSearching(true);
    setAnalyzing(false);
    setSearchResults([]);
    setSelectedChunkIds([]);
    setRetrievalMode('none');
    setSearchMetadata(null);

    try {
      const validFileIds = referencedFiles
        .map((file) => file.file_id)
        .filter((id): id is string => Boolean(id && id.trim()));

      const response = await apiService.searchKnowledge(query, {
        context_limit: contextLimit,
        similarity_threshold: similarityThreshold,
        max_results: Math.max(contextLimit * 4, 10),
        file_ids: validFileIds.length > 0 ? validFileIds : undefined,
      });

      if (response.success) {
        const data = response.data as ChatSearchResponse;
        setSearchResults(data.results);
        setRetrievalMode(data.retrieval_mode);
        setSearchMetadata(data.metadata);
        if (data.results.length > 0) {
          setSelectedChunkIds(
            data.results
              .slice(0, contextLimit)
              .map((item) => item.chunk_record_id)
          );
        } else {
          message.info(t('search.messages.searchNoResults'));
        }
      } else {
        message.error(response.message || t('search.messages.askFailed'));
      }
    } catch (error) {
      console.error('Search error:', error);
      message.error(t('search.messages.askRequestFailed'));
    } finally {
      setSearching(false);
    }
  };

  const handleAnalyze = async () => {
    if (!questionQuery.trim()) {
      message.warning(t('search.messages.emptyQuestion'));
      return;
    }

    const selected = searchResults.filter((item) =>
      selectedChunkIds.includes(item.chunk_record_id)
    );

    if (selected.length === 0) {
      message.warning(t('search.messages.noChunksSelected'));
      return;
    }

    setAnalyzing(true);
    try {
      const selections = selected.map((item) => ({
        chunk_record_id: item.chunk_record_id,
        relevance_score: item.relevance_score,
        match_reason: item.match_reason,
      }));

      const response = await apiService.analyzeQuestion(questionQuery, selections, {
        context_limit: contextLimit,
        similarity_threshold: similarityThreshold,
        temperature,
        max_tokens: maxTokens,
      });

      if (response.success) {
        const data = response.data as QuestionResponse;
        setQuestionResult(data);
      } else {
        message.error(response.message || t('search.messages.askFailed'));
      }
    } catch (error) {
      console.error('Analyze error:', error);
      message.error(t('search.messages.askRequestFailed'));
    } finally {
      setAnalyzing(false);
    }
  };

  const toggleChunkSelection = (chunkRecordId: number, checked: boolean) => {
    setSelectedChunkIds((prev) => {
      if (checked) {
        return Array.from(new Set([...prev, chunkRecordId]));
      }
      return prev.filter((id) => id !== chunkRecordId);
    });
  };

  const selectTopChunks = () => {
    setSelectedChunkIds(
      searchResults
        .slice(0, contextLimit)
        .map((item) => item.chunk_record_id)
    );
  };

  const clearSelectedChunks = () => {
    setSelectedChunkIds([]);
  };

  const matchReasonLabel = (reason: string) => {
    switch (reason) {
      case 'keyword-content':
        return t('search.qa.matchReason.content');
      case 'keyword-name':
        return t('search.qa.matchReason.fileName');
      case 'keyword-category':
        return t('search.qa.matchReason.category');
      case 'keyword-tag':
        return t('search.qa.matchReason.tag');
      case 'vector':
      default:
        return t('search.qa.matchReason.vector');
    }
  };

  const retrievalModeLabel = () => {
    switch (retrievalMode) {
      case 'keyword':
        return t('search.qa.retrievalMode.keyword');
      case 'vector':
        return t('search.qa.retrievalMode.vector');
      case 'manual':
        return t('search.qa.retrievalMode.manual');
      default:
        return t('search.qa.retrievalMode.none');
    }
  };

  const handlePreviewChunk = async (chunkId: string) => {
    setPreviewLoading(true);
    setPreviewVisible(true);
    try {
      const response = await apiService.getChunkContent(chunkId);
      if (response.success) {
        const data = response.data as ChunkContent;
        setPreviewChunk(data);
      } else {
        message.error(response.message || t('search.messages.getChunkFailed'));
        setPreviewVisible(false);
      }
    } catch (error) {
      console.error('Preview chunk error:', error);
      message.error(t('search.messages.getChunkFailed'));
      setPreviewVisible(false);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleOpenFile = async (filePath: string, chunkContent?: string) => {
    // 如果提供了chunk内容，先复制前20个字符到剪贴板
    if (chunkContent && window.electronAPI?.copyToClipboard) {
      const textToCopy = chunkContent.length > 20 ? chunkContent.substring(0, 20) : chunkContent;
      try {
        const success = await window.electronAPI.copyToClipboard(textToCopy);
        if (success) {
          message.success(t('search.messages.copySuccess', { text: textToCopy }));
        } else {
          message.warning(t('search.messages.copyFailed'));
        }
      } catch (error) {
        console.error('Copy to clipboard error:', error);
        message.warning(t('search.messages.copyFailed'));
      }
    }

    // 然后打开文件
    if (window.electronAPI?.openFile) {
      window.electronAPI.openFile(filePath).then(success => {
        if (!success) {
          message.error(t('search.messages.openFileFailed'));
        }
      });
    } else {
      message.error(t('search.messages.openFileNotSupported'));
    }
  };

  const handleClosePreview = () => {
    setPreviewVisible(false);
    setPreviewChunk(null);
  };

  // Filename search removed

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sidebar selectedMenu={selectedMenu} />
      <Layout>
        <Content style={{ padding: '24px', background: '#fff' }}>
          {/* QA view only */}
          <div style={{ marginBottom: '24px' }}>
            {/* Referenced files */}
            {referencedFiles.length > 0 && (
              <Card
                size="small"
                style={{ marginBottom: '16px', background: '#f6ffed', border: '1px solid #b7eb8f' }}
                title={
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span>📄 {t('search.qa.referencedFiles')}</span>
                    <Tag color="green">{referencedFiles.length}</Tag>
                  </div>
                }
              >
                {referencedFiles.map(file => (
                  <div key={file.file_id} style={{ marginBottom: '8px' }}>
                    <div style={{ fontWeight: 'bold', fontSize: '14px' }}>{file.file_name}</div>
                    <div style={{ color: '#666', fontSize: '12px' }}>{file.file_path}</div>
                  </div>
                ))}
              </Card>
            )}

            {/* Similarity and generation settings */}
            <Card size="small" style={{ marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <span style={{ fontWeight: 'bold', minWidth: '80px' }}>
                  {t('search.qa.similarityThreshold')}:
                </span>
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '12px', maxWidth: '200px' }}>
                  <Slider
                    min={0}
                    max={1}
                    step={0.1}
                    value={similarityThreshold}
                    onChange={setSimilarityThreshold}
                    style={{ flex: 1 }}
                    tooltip={{ formatter: (value) => `${(value! * 100).toFixed(0)}%` }}
                  />
                  <span style={{ minWidth: '40px', textAlign: 'right' }}>
                    {(similarityThreshold * 100).toFixed(0)}%
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontWeight: 'bold', minWidth: '60px' }}>
                    {t('search.qa.contextLimit')}:
                  </span>
                  <InputNumber
                    min={1}
                    max={20}
                    value={contextLimit}
                    onChange={(value) => setContextLimit(value || 5)}
                    style={{ width: '80px' }}
                  />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontWeight: 'bold', minWidth: '60px' }}>
                    {t('search.qa.maxTokens')}:
                  </span>
                  <InputNumber
                    min={100}
                    max={4000}
                    step={100}
                    value={maxTokens}
                    onChange={(value) => setMaxTokens(value || 2000)}
                    style={{ width: '100px' }}
                  />
                </div>
                
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontWeight: 'bold', minWidth: '60px' }}>
                    {t('search.qa.temperature')}:
                  </span>
                  <InputNumber
                    min={0}
                    max={2}
                    step={0.1}
                    value={temperature}
                    onChange={(value) => setTemperature(value || 0.7)}
                    style={{ width: '80px' }}
                  />
                </div>
              </div>
            </Card>

            <Search
              placeholder={t('search.placeholders.qa')}
              enterButton={
                <Button type="primary" icon={<QuestionCircleOutlined />}>
                  {t('search.buttons.ask')}
                </Button>
              }
              size="large"
              value={questionQuery}
              onChange={(e) => setQuestionQuery(e.target.value)}
              onSearch={handleSearchCandidates}
              loading={searching}
            />
          </div>

          {(searching || searchResults.length > 0 || retrievalMode !== 'none') && (
            <Card
              size="small"
              style={{ marginBottom: '16px' }}
              title={
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>{t('search.qa.searchResultsTitle')}</span>
                  <Tag color={retrievalMode === 'vector' ? 'purple' : retrievalMode === 'keyword' ? 'blue' : 'default'}>
                    {retrievalModeLabel()}
                  </Tag>
                  <Tag color="geekblue">
                    {t('search.qa.resultsCount', { count: searchResults.length })}
                  </Tag>
                  {searchMetadata && (
                    <Tag color="default">
                      {t('search.qa.retrievalTime', { value: searchMetadata.retrieval_time_ms })}
                    </Tag>
                  )}
                </div>
              }
              extra={
                <Space size="small">
                  <Tag color="green">
                    {t('search.qa.selectedCount', { count: selectedChunkIds.length })}
                  </Tag>
                  <Button size="small" onClick={selectTopChunks} disabled={searchResults.length === 0}>
                    {t('search.qa.selectTop', { count: contextLimit })}
                  </Button>
                  <Button size="small" onClick={clearSelectedChunks} disabled={selectedChunkIds.length === 0}>
                    {t('search.qa.clearSelection')}
                  </Button>
                  <Button
                    type="primary"
                    size="small"
                    icon={<QuestionCircleOutlined />}
                    onClick={handleAnalyze}
                    loading={analyzing}
                    disabled={selectedChunkIds.length === 0 || searching}
                  >
                    {t('search.buttons.analyze')}
                  </Button>
                </Space>
              }
            >
              {searching ? (
                <div style={{ textAlign: 'center', padding: '24px' }}>
                  <Spin size="large" />
                </div>
              ) : searchResults.length === 0 ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={t('search.qa.noResultsPlaceholder')}
                />
              ) : (
                <List
                  dataSource={searchResults}
                  renderItem={(item) => {
                    const checked = selectedChunkIds.includes(item.chunk_record_id);
                    return (
                      <List.Item key={item.chunk_record_id} style={{ padding: '12px 0' }}>
                        <div style={{ display: 'flex', width: '100%', gap: '12px' }}>
                          <Checkbox
                            checked={checked}
                            onChange={(e) => toggleChunkSelection(item.chunk_record_id, e.target.checked)}
                            style={{ marginTop: 4 }}
                          />
                          <div style={{ flex: 1 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                              <span style={{ fontWeight: 'bold' }}>{item.file_name}</span>
                              <Tag color={item.match_reason === 'vector' ? 'purple' : 'blue'}>
                                {matchReasonLabel(item.match_reason)}
                              </Tag>
                              <Tag color="geekblue">
                                {t('search.qa.relevance', { value: (item.relevance_score * 100).toFixed(1) })}
                              </Tag>
                            </div>
                            <div style={{ color: '#666', fontSize: '12px', marginBottom: '6px' }}>
                              {item.file_path}
                            </div>
                            <div
                              style={{
                                color: '#333',
                                fontSize: '13px',
                                background: '#f9f9f9',
                                borderRadius: '4px',
                                padding: '8px',
                                border: '1px solid #e8e8e8',
                                marginBottom: '8px',
                                whiteSpace: 'pre-wrap',
                              }}
                            >
                              {item.snippet}
                            </div>
                            <Space size="small">
                              <Button size="small" icon={<EyeOutlined />} onClick={() => handlePreviewChunk(item.chunk_id)}>
                                {t('search.qa.preview')}
                              </Button>
                              <Button
                                size="small"
                                icon={<FolderOpenOutlined />}
                                onClick={() => handleOpenFile(item.file_path, item.snippet)}
                              >
                                {t('search.qa.openFile')}
                              </Button>
                            </Space>
                          </div>
                        </div>
                      </List.Item>
                    );
                  }}
                />
              )}
            </Card>
          )}

          {
            <>
              {analyzing ? (
                <div style={{ textAlign: 'center', padding: '50px' }}>
                  <Spin size="large" />
                  <div style={{ marginTop: '16px' }}>{t('search.loading.thinking')}</div>
                </div>
              ) : questionResult && (
                <Card
                  title={
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <QuestionCircleOutlined />
                      <span>{t('search.qa.resultTitle')}</span>
                      <Tag color={questionResult.confidence > 0.8 ? 'green' : questionResult.confidence > 0.6 ? 'orange' : 'red'}>
                        {t('search.qa.confidence')} {(questionResult.confidence * 100).toFixed(1)}%
                      </Tag>
                    </div>
                  }
                  variant="borderless"
                >
                  <div style={{ marginBottom: '16px' }}>
                    <div style={{ fontSize: '16px', lineHeight: '1.6', marginBottom: '16px' }}>
                      {questionResult.answer}
                    </div>
                    <div style={{ color: '#666', fontSize: '12px' }}>
                      模型: {questionResult.metadata.model_used} |
                      Token使用: {questionResult.metadata.tokens_used} |
                      响应时间: {questionResult.metadata.response_time_ms}ms
                    </div>
                  </div>

                  {questionResult.sources && questionResult.sources.length > 0 && (
                    <div>
                      <div style={{ fontWeight: 'bold', marginBottom: '12px' }}>{t('search.qa.sources')}</div>
                      <List
                        dataSource={questionResult.sources}
                        renderItem={(source) => (
                          <List.Item
                            style={{
                              padding: '12px',
                              border: '1px solid #f0f0f0',
                              borderRadius: '6px',
                              marginBottom: '8px'
                            }}
                          >
                            <List.Item.Meta
                              title={
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  <span style={{ fontSize: '14px', fontWeight: 'bold' }}>
                                    {source.file_name}
                                  </span>
                                  <Tag color="blue">
                                    相关度: {(source.relevance_score * 100).toFixed(1)}%
                                  </Tag>
                                </div>
                              }
                              description={
                                <div>
                                  <div style={{ marginBottom: '8px', color: '#666', fontSize: '12px' }}>
                                    {t('search.qa.path')} {source.file_path}
                                  </div>
                                  <div style={{ marginBottom: '8px', color: '#999', fontSize: '12px' }}>
                                    {t('search.qa.chunk', { index: source.chunk_index + 1 })}
                                  </div>
                                  {source.chunk_content && (
                                    <div style={{ marginBottom: '12px' }}>
                                      <div style={{ fontSize: '13px', color: '#333', lineHeight: '1.5', padding: '8px', background: '#f9f9f9', borderRadius: '4px', border: '1px solid #e8e8e8' }}>
                                        {source.chunk_content.length > 150 
                                          ? `${source.chunk_content.substring(0, 150)}...` 
                                          : source.chunk_content}
                                      </div>
                                    </div>
                                  )}
                                  <div style={{ display: 'flex', gap: '8px' }}>
                                    <Button
                                      size="small"
                                      icon={<EyeOutlined />}
                                      onClick={() => handlePreviewChunk(source.chunk_id)}
                                    >
                                      {t('search.qa.preview')}
                                    </Button>
                                    <Button
                                      size="small"
                                      icon={<FolderOpenOutlined />}
                                      onClick={() => handleOpenFile(source.file_path, source.chunk_content)}
                                    >
                                      {t('search.qa.openFile')}
                                    </Button>
                                  </div>
                                </div>
                              }
                            />
                          </List.Item>
                        )}
                      />
                    </div>
                  )}
                </Card>
              )}
            </>
          }
        </Content>
      </Layout>

      {/* 分段内容预览模态框 */}
      <Modal
        title={
          previewChunk ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <EyeOutlined />
              <span>{previewChunk.file_name} - {t('search.qa.chunk', { index: previewChunk.chunk_index + 1 })}</span>
            </div>
          ) : t('search.modal.previewTitle')
        }
        open={previewVisible}
        onCancel={handleClosePreview}
        footer={[
          <Button key="close" onClick={handleClosePreview}>
            {t('search.modal.close')}
          </Button>,
          previewChunk && (
            <Button
              key="openFile"
              icon={<FolderOpenOutlined />}
              onClick={() => handleOpenFile(previewChunk.file_path, previewChunk.content)}
            >
              {t('search.modal.openFile')}
            </Button>
          ),
        ]}
        width={800}
        style={{ maxHeight: '80vh' }}
      >
        {previewLoading ? (
          <div style={{ textAlign: 'center', padding: '50px' }}>
            <Spin size="large" />
            <div style={{ marginTop: '16px' }}>{t('search.modal.loading')}</div>
          </div>
        ) : previewChunk ? (
          <div>
            <div style={{ marginBottom: '16px', padding: '12px', background: '#f5f5f5', borderRadius: '4px' }}>
              <div style={{ display: 'flex', gap: '16px', fontSize: '12px', color: '#666' }}>
                <span>{t('search.preview.contentType')} {previewChunk.content_type}</span>
                <span>{t('search.preview.charCount')} {previewChunk.char_count}</span>
                <span>{t('search.preview.tokenCount')} {previewChunk.token_count}</span>
              </div>
            </div>
            <div
              style={{
                maxHeight: '400px',
                overflow: 'auto',
                padding: '16px',
                border: '1px solid #d9d9d9',
                borderRadius: '4px',
                background: '#fafafa',
                whiteSpace: 'pre-wrap',
                fontFamily: 'monospace',
                fontSize: '14px',
                lineHeight: '1.6'
              }}
            >
              {previewChunk.content}
            </div>
          </div>
        ) : null}
      </Modal>
    </Layout>
  );
};

export default SearchPage;