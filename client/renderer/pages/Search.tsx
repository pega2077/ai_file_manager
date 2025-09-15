import { useState } from 'react';
import { Layout, Input, Button, List, Spin, message, Tag, Pagination, Card, Tabs } from 'antd';
import { SearchOutlined, QuestionCircleOutlined } from '@ant-design/icons';
import { apiService } from '../services/api';
import Sidebar from '../components/Sidebar';
import { useNavigate } from 'react-router-dom';

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

const SearchPage = () => {
  const navigate = useNavigate();
  const [selectedMenu, setSelectedMenu] = useState('search');
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

  const handleMenuClick = ({ key }: { key: string }) => {
    setSelectedMenu(key);

    switch (key) {
      case 'files':
        navigate('/home');
        break;
      case 'search':
        // 已经在搜索页面
        break;
      case 'settings':
        navigate('/settings');
        break;
      default:
        break;
    }
  };

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
      <Sidebar selectedMenu={selectedMenu} onMenuClick={handleMenuClick} />
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
                                  <div style={{ marginBottom: '4px', color: '#666', fontSize: '12px' }}>
                                    路径: {source.file_path}
                                  </div>
                                  <div style={{ color: '#999', fontSize: '12px' }}>
                                    分段 {source.chunk_index + 1}
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
    </Layout>
  );
};

export default SearchPage;