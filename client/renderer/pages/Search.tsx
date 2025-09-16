import { useState } from 'react';
import { Layout, Input, Button, List, Spin, message, Tag, Pagination, Card, Tabs, Modal } from 'antd';
import { SearchOutlined, QuestionCircleOutlined, EyeOutlined, FolderOpenOutlined } from '@ant-design/icons';
import { apiService } from '../services/api';
import Sidebar from '../components/Sidebar';

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

  // 标签页状态
  const [activeTab, setActiveTab] = useState('search');

  // 分段预览状态
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewChunk, setPreviewChunk] = useState<ChunkContent | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const handleSearch = async (value: string) => {
    if (!value.trim()) {
      message.warning('请输入搜索关键词');
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
        message.error(response.message || '搜索失败');
      }
    } catch (error) {
      console.error('Search error:', error);
      message.error('搜索请求失败');
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
      message.warning('请输入问题');
      return;
    }

    setAsking(true);
    try {
      const response = await apiService.askQuestion(value);
      if (response.success) {
        const data = response.data as QuestionResponse;
        setQuestionResult(data);
      } else {
        message.error(response.message || '提问失败');
      }
    } catch (error) {
      console.error('Question error:', error);
      message.error('提问请求失败');
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
        message.error(response.message || '获取分段内容失败');
        setPreviewVisible(false);
      }
    } catch (error) {
      console.error('Preview chunk error:', error);
      message.error('获取分段内容失败');
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
          message.success(`已复制"${textToCopy}"到剪贴板`);
        } else {
          message.warning('复制到剪贴板失败');
        }
      } catch (error) {
        console.error('Copy to clipboard error:', error);
        message.warning('复制到剪贴板失败');
      }
    }

    // 然后打开文件
    if (window.electronAPI?.openFile) {
      window.electronAPI.openFile(filePath).then(success => {
        if (!success) {
          message.error('打开文件失败');
        }
      });
    } else {
      message.error('不支持的文件打开功能');
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
                      文件名搜索
                    </span>
                  ),
                  children: (
                    <Search
                      placeholder="输入文件名关键词进行搜索"
                      enterButton={
                        <Button type="primary" icon={<SearchOutlined />}>
                          搜索
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
                      智能问答
                    </span>
                  ),
                  children: (
                    <Search
                      placeholder="输入问题进行智能问答"
                      enterButton={
                        <Button type="primary" icon={<QuestionCircleOutlined />}>
                          提问
                        </Button>
                      }
                      size="large"
                      value={questionQuery}
                      onChange={(e) => setQuestionQuery(e.target.value)}
                      onSearch={handleAskQuestion}
                      loading={asking}
                    />
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
                  <div style={{ marginTop: '16px' }}>正在搜索中...</div>
                </div>
              ) : (
                <>
                  {searchResults.length > 0 && (
                    <div style={{ marginBottom: '16px' }}>
                      <span>找到 {totalResults} 个结果</span>
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
                  <div style={{ marginTop: '16px' }}>正在思考中...</div>
                </div>
              ) : questionResult && (
                <Card
                  title={
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <QuestionCircleOutlined />
                      <span>智能问答结果</span>
                      <Tag color={questionResult.confidence > 0.8 ? 'green' : questionResult.confidence > 0.6 ? 'orange' : 'red'}>
                        置信度: {(questionResult.confidence * 100).toFixed(1)}%
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
                      <div style={{ fontWeight: 'bold', marginBottom: '12px' }}>参考来源:</div>
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
                                    路径: {source.file_path}
                                  </div>
                                  <div style={{ marginBottom: '8px', color: '#999', fontSize: '12px' }}>
                                    分段 {source.chunk_index + 1}
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
                                      预览内容
                                    </Button>
                                    <Button
                                      size="small"
                                      icon={<FolderOpenOutlined />}
                                      onClick={() => handleOpenFile(source.file_path, source.chunk_content)}
                                    >
                                      打开文件
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
              <span>{previewChunk.file_name} - 分段 {previewChunk.chunk_index + 1}</span>
            </div>
          ) : '分段内容预览'
        }
        open={previewVisible}
        onCancel={handleClosePreview}
        footer={[
          <Button key="close" onClick={handleClosePreview}>
            关闭
          </Button>,
          previewChunk && (
            <Button
              key="openFile"
              icon={<FolderOpenOutlined />}
              onClick={() => handleOpenFile(previewChunk.file_path, previewChunk.content)}
            >
              打开文件
            </Button>
          ),
        ]}
        width={800}
        style={{ maxHeight: '80vh' }}
      >
        {previewLoading ? (
          <div style={{ textAlign: 'center', padding: '50px' }}>
            <Spin size="large" />
            <div style={{ marginTop: '16px' }}>正在加载分段内容...</div>
          </div>
        ) : previewChunk ? (
          <div>
            <div style={{ marginBottom: '16px', padding: '12px', background: '#f5f5f5', borderRadius: '4px' }}>
              <div style={{ display: 'flex', gap: '16px', fontSize: '12px', color: '#666' }}>
                <span>内容类型: {previewChunk.content_type}</span>
                <span>字符数: {previewChunk.char_count}</span>
                <span>Token数: {previewChunk.token_count}</span>
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