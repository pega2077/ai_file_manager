import React, { useState, useEffect, useCallback } from 'react';
import { Table, Button, message, Input, Select, Tag, Space, Pagination } from 'antd';
import { EyeOutlined, FolderOpenOutlined, FileTextOutlined, SearchOutlined, CheckCircleOutlined, CloseCircleOutlined, DatabaseOutlined } from '@ant-design/icons';
import { apiService } from '../services/api';
import FilePreview from './FilePreview';
import { ImportedFileItem } from '../shared/types';

const { Option } = Select;

interface PaginationInfo {
  current_page: number;
  total_pages: number;
  total_count: number;
  limit: number;
}

interface FileListResponse {
  files: ImportedFileItem[];
  pagination: PaginationInfo;
}

interface FileListProps {
  onFileSelect?: (file: ImportedFileItem) => void;
  refreshTrigger?: number;
}

const FileList: React.FC<FileListProps> = ({ onFileSelect, refreshTrigger }) => {
  const [files, setFiles] = useState<ImportedFileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [workDirectory, setWorkDirectory] = useState<string>('workdir');
  const [pagination, setPagination] = useState<PaginationInfo>({
    current_page: 1,
    total_pages: 1,
    total_count: 0,
    limit: 20
  });

  // 筛选条件
  const [filters, setFilters] = useState({
    search: '',
    category: '',
    type: '',
    tags: [] as string[],
    sort_by: '',
    sort_order: 'desc'
  });

  // 预览状态
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewFile, setPreviewFile] = useState<{ path: string; name: string } | null>(null);

  // 获取文件列表
  const fetchFiles = useCallback(async (page: number = 1) => {
    setLoading(true);
    try {
      const params = {
        page,
        limit: pagination.limit,
        ...filters
      };

      const response = await apiService.getFileList(params);
      if (response.success) {
        const data = response.data as FileListResponse;
        setFiles(data.files);
        setPagination(data.pagination);
      } else {
        message.error(response.message || '获取文件列表失败');
      }
    } catch (error) {
      console.error('获取文件列表失败:', error);
      message.error('获取文件列表失败');
    } finally {
      setLoading(false);
    }
  }, [pagination.limit, filters]);

  // 预览文件
  const handlePreview = (file: ImportedFileItem) => {
    setPreviewFile({ path: file.path, name: file.name });
    setPreviewVisible(true);
  };

  // 打开文件目录
  const handleOpenDirectory = async (file: ImportedFileItem) => {
    try {
      // 使用 path.dirname 获取目录路径
      const dirPath = file.path.substring(0, file.path.lastIndexOf('\\')) ||
                     file.path.substring(0, file.path.lastIndexOf('/'));

      if (window.electronAPI && window.electronAPI.openFolder) {
        const success = await window.electronAPI.openFolder(dirPath);
        if (!success) {
          message.error('打开目录失败');
        }
      } else {
        message.error('不支持打开目录功能');
      }
    } catch (error) {
      console.error('打开目录失败:', error);
      message.error('打开目录失败');
    }
  };

  // 打开文件
  const handleOpenFile = async (file: ImportedFileItem) => {
    try {
      if (window.electronAPI && window.electronAPI.openFile) {
        const success = await window.electronAPI.openFile(file.path);
        if (!success) {
          message.error('打开文件失败');
        }
      } else {
        message.error('不支持打开文件功能');
      }
    } catch (error) {
      console.error('打开文件失败:', error);
      message.error('打开文件失败');
    }
  };

  // 导入到知识库
  const handleImportToRag = async (file: ImportedFileItem) => {
    try {
      const loadingKey = message.loading(`正在导入文件 "${file.name}" 到知识库...`, 0);
      
      const response = await apiService.importToRag(file.path);
      loadingKey();
      
      if (response.success) {
        message.success(`文件 "${file.name}" 已成功导入知识库`);
        // 刷新文件列表以更新状态
        fetchFiles(pagination.current_page);
      } else {
        message.error(response.message || `导入文件 "${file.name}" 失败`);
      }
    } catch (error) {
      message.error(`导入文件 "${file.name}" 失败`);
      console.error('导入知识库失败:', error);
    }
  };

  // 获取相对于工作目录的路径
  const getRelativePath = (fullPath: string): string => {
    // 规范化路径分隔符
    const normalizedPath = fullPath.replace(/\\/g, '/');
    const normalizedWorkDir = workDirectory.replace(/\\/g, '/');

    // 如果路径以工作目录开头，返回相对路径
    if (normalizedPath.startsWith(normalizedWorkDir)) {
      const relativePath = normalizedPath.substring(normalizedWorkDir.length);
      return relativePath.startsWith('/') ? relativePath.substring(1) : relativePath;
    }

    // 如果不以工作目录开头，返回原路径
    return fullPath;
  };

  // 格式化文件大小
  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // 表格列配置
  const columns = [
    {
      title: '文件名',
      dataIndex: 'name',
      key: 'name',
      ellipsis: false,
      width: 200,
      sorter: true,
      render: (name: string) => (
        <div>
          <FileTextOutlined style={{ marginRight: 8 }} />
          <span>{name}</span>
        </div>
      ),
    },
    {
      title: '文件路径',
      dataIndex: 'path',
      key: 'path',
      ellipsis: true,
      width: 200,
      render: (path: string) => (
        <span style={{ fontSize: '12px', color: '#666' }} title={path}>
          {getRelativePath(path)}
        </span>
      ),
    },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      width: 100,
      render: (type: string) => (
        <Tag color="blue">{type}</Tag>
      ),
    },
    {
      title: '分类',
      dataIndex: 'category',
      key: 'category',
      width: 120,
      render: (category: string) => (
        <Tag color="green">{category || '未分类'}</Tag>
      ),
    },
    {
      title: '大小',
      dataIndex: 'size',
      key: 'size',
      width: 100,
      sorter: true,
      render: (size: number) => formatFileSize(size),
    },
    {
      title: '标签',
      dataIndex: 'tags',
      key: 'tags',
      render: (tags: string[]) => (
        <div>
          {tags.map(tag => (
            <Tag key={tag}>{tag}</Tag>
          ))}
        </div>
      ),
    },
    {
      title: '添加时间',
      dataIndex: 'added_at',
      key: 'added_at',
      width: 150,
      sorter: true,
      render: (date: string) => new Date(date).toLocaleString(),
    },
    {
      title: '知识库状态',
      dataIndex: 'processed',
      key: 'processed',
      width: 120,
      render: (processed: boolean) => (
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {processed ? (
            <>
              <CheckCircleOutlined style={{ color: '#52c41a', marginRight: 8 }} />
              <span style={{ color: '#52c41a' }}>已导入</span>
            </>
          ) : (
            <>
              <CloseCircleOutlined style={{ color: '#ff4d4f', marginRight: 8 }} />
              <span style={{ color: '#ff4d4f' }}>未导入</span>
            </>
          )}
        </div>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 200,
      render: (_: unknown, record: ImportedFileItem) => (
        <Space>
          <Button
            type="text"
            icon={<EyeOutlined />}
            onClick={() => handlePreview(record)}
            title="预览"
          />
          <Button
            type="text"
            icon={<FolderOpenOutlined />}
            onClick={() => handleOpenDirectory(record)}
            title="打开目录"
          />
          <Button
            type="text"
            icon={<FileTextOutlined />}
            onClick={() => handleOpenFile(record)}
            title="打开文件"
          />
          <Button
            type="text"
            icon={<DatabaseOutlined />}
            onClick={() => handleImportToRag(record)}
            title="导入知识库"
            disabled={record.processed}
          />
        </Space>
      ),
    },
  ];

  // 处理筛选条件变化
  const handleFilterChange = (key: string, value: string | string[]) => {
    setFilters(prev => ({
      ...prev,
      [key]: value
    }));
  };

  // 处理分页变化
  const handlePageChange = (page: number) => {
    fetchFiles(page);
  };

  // 处理表格变化（排序、分页等）
  const handleTableChange = (...args: any[]) => {
    const sorter = args[2];
    if (sorter.field && sorter.order) {
      const sortOrder = sorter.order === 'ascend' ? 'asc' : 'desc';
      setFilters(prev => ({
        ...prev,
        sort_by: sorter.field,
        sort_order: sortOrder
      }));
    } else {
      // 取消排序
      setFilters(prev => ({
        ...prev,
        sort_by: '',
        sort_order: 'desc'
      }));
    }
  };

  // 搜索
  const handleSearch = () => {
    fetchFiles(1);
  };

  // 初始化加载
  useEffect(() => {
    // 获取工作目录设置
    const loadWorkDirectory = async () => {
      if (window.electronStore) {
        try {
          const storedWorkDirectory = await window.electronStore.get('workDirectory') as string;
          if (storedWorkDirectory) {
            setWorkDirectory(storedWorkDirectory);
          }
        } catch (error) {
          console.error('Failed to load workDirectory:', error);
        }
      }
    };

    loadWorkDirectory();
    // 不在这里调用 fetchFiles，因为 filters 的 useEffect 会处理
  }, []);

  // 监听刷新触发器
  useEffect(() => {
    if (refreshTrigger && refreshTrigger > 0) {
      fetchFiles();
    }
  }, [refreshTrigger, fetchFiles]);

  // 监听筛选条件变化，自动重新获取数据
  useEffect(() => {
    fetchFiles(1);
  }, [filters, fetchFiles]);

  return (
    <div style={{ padding: 16 }}>
      {/* 筛选条件 */}
      <div style={{ marginBottom: 16, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <Input
          placeholder="搜索文件名"
          prefix={<SearchOutlined />}
          value={filters.search}
          onChange={(e) => handleFilterChange('search', e.target.value)}
          onPressEnter={handleSearch}
          style={{ width: 200 }}
        />
        <Select
          placeholder="选择分类"
          value={filters.category}
          onChange={(value) => handleFilterChange('category', value)}
          style={{ width: 150 }}
          allowClear
        >
          <Option value="document">文档</Option>
          <Option value="image">图片</Option>
          <Option value="video">视频</Option>
          <Option value="audio">音频</Option>
          <Option value="archive">压缩包</Option>
          <Option value="other">其他</Option>
        </Select>
        <Select
          placeholder="选择类型"
          value={filters.type}
          onChange={(value) => handleFilterChange('type', value)}
          style={{ width: 150 }}
          allowClear
        >
          <Option value="pdf">PDF</Option>
          <Option value="docx">Word</Option>
          <Option value="xlsx">Excel</Option>
          <Option value="pptx">PowerPoint</Option>
          <Option value="txt">文本</Option>
          <Option value="jpg">JPG</Option>
          <Option value="png">PNG</Option>
          <Option value="mp4">MP4</Option>
          <Option value="zip">ZIP</Option>
        </Select>
        <Button type="primary" onClick={handleSearch}>
          搜索
        </Button>
      </div>

      {/* 文件列表表格 */}
      <Table
        columns={columns}
        dataSource={files}
        rowKey="name"
        loading={loading}
        pagination={false}
        size="small"
        onChange={handleTableChange}
        onRow={(record) => ({
          onClick: () => onFileSelect?.(record),
        })}
      />

      {/* 分页 */}
      {pagination.total_pages > 1 && (
        <div style={{ marginTop: 16, textAlign: 'right' }}>
          <Pagination
            current={pagination.current_page}
            total={pagination.total_count}
            pageSize={pagination.limit}
            onChange={handlePageChange}
            showSizeChanger={false}
            showQuickJumper
            showTotal={(total, range) =>
              `第 ${range[0]}-${range[1]} 条，共 ${total} 条`
            }
          />
        </div>
      )}

      {/* 预览模态框 */}
      {previewFile && (
        <FilePreview
          filePath={previewFile.path}
          fileName={previewFile.name}
          visible={previewVisible}
          onClose={() => {
            setPreviewVisible(false);
            setPreviewFile(null);
          }}
        />
      )}
    </div>
  );
};

export default FileList;