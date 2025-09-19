import { useState, useEffect } from 'react';
import { Layout, Input, Button, List, Spin, message, Tag, Pagination, Card, Tabs, Modal, Slider, InputNumber } from 'antd';
import { SearchOutlined, QuestionCircleOutlined, EyeOutlined, FolderOpenOutlined } from '@ant-design/icons';
import { useSearchParams } from 'react-router-dom';
import { apiService } from '../services/api';
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
  added_at: string;
  tags: string[];
}

interface SearchResponse {
  results: SearchResult[];
  pagination: {
    current_page: number;
    total_pages: number;
    total_count: number;
    limit: number;
  };
  search_metadata: {
    query: string;
    total_results: number;
    search_time_ms: number;
    filters_applied: {
      file_types: string[];
      categories: string[];
    };
  };
}

interface QuestionSource {
  file_id: string;
  file_name: string;
  file_path: string;
  chunk_id: string;
  chunk_content: string;
  chunk_index: number;
  relevance_score: number;
}

interface QuestionResponse {
  answer: string;
  confidence: number;
  sources: QuestionSource[];
  metadata: {
    model_used: string;
    tokens_used: number;
    response_time_ms: number;
    retrieval_time_ms: number;
    generation_time_ms: number;
  };
}

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
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalResults, setTotalResults] = useState(0);
  const [pageSize] = useState(20);

  // 提问相关状态
  const [questionQuery, setQuestionQuery] = useState('');
  const [questionResult, setQuestionResult] = useState<QuestionResponse | null>(null);
  const [asking, setAsking] = useState(false);
  const [referencedFiles, setReferencedFiles] = useState<SearchResult[]>([]);
  const [similarityThreshold, setSimilarityThreshold] = useState(0.4);
  const [contextLimit, setContextLimit] = useState(5);
  const [maxTokens, setMaxTokens] = useState(1000);
  const [temperature, setTemperature] = useState(0.7);

  // 标签页状态
  const [activeTab, setActiveTab] = useState('search');

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
                added_at: string;
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
                added_at: fileData.added_at,
                tags: fileData.tags || []
              });
            }
          }
          setReferencedFiles(files);
          setActiveTab('question'); // 切换到问答标签页
        } catch (error) {
          console.error('Failed to load referenced files:', error);
          message.error(t('search.messages.loadReferencedFilesFailed'));
        }
      };

      loadReferencedFiles();
    }
  }, [searchParams, t]);

  const handleSearch = async (value: string) => {
    if (!value.trim()) {
      message.warning(t('search.messages.emptyQuery'));
      return;
    }

    setLoading(true);
    try {
      const response = await apiService.filenameSearch(value, currentPage, pageSize);
      if (response.success) {
        const data = response.data as SearchResponse;
        setSearchResults(data.results);
        setTotalResults(data.pagination.total_count);
        setCurrentPage(data.pagination.current_page);
      } else {
        message.error(response.message || t('search.messages.searchFailed'));
      }
    } catch (error) {
      console.error('Search error:', error);
      message.error(t('search.messages.searchRequestFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    if (searchQuery) {
      handleSearch(searchQuery);
    }
  };

  const handleAskQuestion = async (value: string) => {
    if (!value.trim()) {
      message.warning(t('search.messages.emptyQuestion'));
      return;
    }

    setAsking(true);
    try {
      const options: {
        file_ids?: string[];
        similarity_threshold?: number;
        context_limit?: number;
        max_tokens?: number;
        temperature?: number;
      } = {};
      
      // 如果有引用文件，添加到请求中
      if (referencedFiles.length > 0) {
        const validFileIds = referencedFiles
          .map(file => file.file_id)
          .filter(id => id && typeof id === 'string' && id.trim());
        
        if (validFileIds.length > 0) {
          options.file_ids = validFileIds;
        }
      }
      
      // 设置相似度阈值
      options.similarity_threshold = similarityThreshold;
      
      // 设置其他参数
      options.context_limit = contextLimit;
      options.max_tokens = maxTokens;
      options.temperature = temperature;
      
      console.log('Asking question with options:', options);
      const response = await apiService.askQuestion(value, options);
      if (response.success) {
        const data = response.data as QuestionResponse;
        setQuestionResult(data);
      } else {
        message.error(response.message || t('search.messages.askFailed'));
      }
    } catch (error) {
      console.error('Question error:', error);
      message.error(t('search.messages.askRequestFailed'));
    } finally {
      setAsking(false);
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

  const formatFileSize = (size: number) => {
    if (size === 0) return '0 B';

    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let unitIndex = 0;
    let formattedSize = size;

    while (formattedSize >= 1024 && unitIndex < units.length - 1) {
      formattedSize /= 1024;
      unitIndex++;
    }

    return `${formattedSize.toFixed(1)} ${units[unitIndex]}`;
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sidebar selectedMenu={selectedMenu} />
      <Layout>
        <Content style={{ padding: '24px', background: '#fff' }}>
          <div style={{ marginBottom: '24px' }}>
            <Tabs
              activeKey={activeTab}
              onChange={setActiveTab}
              items={[
                {
                  key: 'search',
                  label: (
                    <span>
                      <SearchOutlined />
                      {t('search.tabs.filenameSearch')}
                    </span>
                  ),
                  children: (
                    <Search
                      placeholder={t('search.placeholders.filenameSearch')}
                      enterButton={
                        <Button type="primary" icon={<SearchOutlined />}>
                          {t('search.buttons.search')}
                        </Button>
                      }
                      size="large"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onSearch={handleSearch}
                      loading={loading}
                    />
                  ),
                },
                {
                  key: 'question',
                  label: (
                    <span>
                      <QuestionCircleOutlined />
                      {t('search.tabs.qa')}
                    </span>
                  ),
                  children: (
                    <div>
                      {/* 显示引用文件 */}
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

                      {/* 相关度设置 */}
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
                        onSearch={handleAskQuestion}
                        loading={asking}
                      />
                    </div>
                  ),
                },
              ]}
            />
          </div>

          {activeTab === 'search' && (
            <>
              {loading ? (
                <div style={{ textAlign: 'center', padding: '50px' }}>
                  <Spin size="large" />
                  <div style={{ marginTop: '16px' }}>{t('search.loading.searching')}</div>
                </div>
              ) : (
                <>
                  {searchResults.length > 0 && (
                    <div style={{ marginBottom: '16px' }}>
                      <span>{t('search.results.found', { count: totalResults })}</span>
                    </div>
                  )}

                  <List
                    dataSource={searchResults}
                    renderItem={(item) => (
                      <List.Item
                        style={{
                          padding: '16px',
                          border: '1px solid #f0f0f0',
                          borderRadius: '8px',
                          marginBottom: '8px'
                        }}
                      >
                        <List.Item.Meta
                          title={
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span style={{ fontSize: '16px', fontWeight: 'bold' }}>
                                {item.file_name}
                              </span>
                              <Tag color="blue">{item.file_type}</Tag>
                              {item.category && <Tag color="green">{item.category}</Tag>}
                            </div>
                          }
                          description={
                            <div>
                              <div style={{ marginBottom: '8px', color: '#666' }}>
                                路径: {item.file_path}
                              </div>
                              <div style={{ marginBottom: '8px', color: '#666' }}>
                                大小: {formatFileSize(item.size)} | 添加时间: {new Date(item.added_at).toLocaleString()}
                              </div>
                              {item.tags && item.tags.length > 0 && (
                                <div>
                                  标签: {item.tags.map(tag => (
                                    <Tag key={tag} style={{ marginRight: '4px' }}>{tag}</Tag>
                                  ))}
                                </div>
                              )}
                            </div>
                          }
                        />
                      </List.Item>
                    )}
                  />

                  {totalResults > pageSize && (
                    <div style={{ textAlign: 'center', marginTop: '24px' }}>
                      <Pagination
                        current={currentPage}
                        total={totalResults}
                        pageSize={pageSize}
                        onChange={handlePageChange}
                        showSizeChanger={false}
                      />
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {activeTab === 'question' && (
            <>
              {asking ? (
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
                  bordered={false}
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
          )}
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