import React, { useState, useEffect, useCallback } from 'react';
import { Layout, Button, message, Modal, Select, TreeSelect, Table, Input, Tag, Space, Pagination } from 'antd';
import { FileAddOutlined, ReloadOutlined, EyeOutlined, FolderOpenOutlined, FileTextOutlined, SearchOutlined, CheckCircleOutlined, CloseCircleOutlined, DatabaseOutlined } from '@ant-design/icons';
import Sidebar from '../components/Sidebar';
import FilePreview from "../components/FilePreview";
import { apiService } from '../services/api';
import { DirectoryItem, DirectoryStructureResponse, RecommendDirectoryResponse, Settings, TreeNode, ImportedFileItem } from '../shared/types';
import { useTranslation } from '../shared/i18n/I18nProvider';

const { Content } = Layout;
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
  const { t } = useTranslation();
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
        message.error(response.message || t('files.messages.fetchFilesFailed'));
      }
    } catch (error) {
      console.error('获取文件列表失败:', error);
      message.error('获取文件列表失败');
    } finally {
      setLoading(false);
    }
  }, [pagination.limit, filters, t]);

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
    fetchFiles(1);
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
      fetchFiles(pagination.current_page);
    } else {
      // 取消排序
      setFilters(prev => ({
        ...prev,
        sort_by: '',
        sort_order: 'desc'
      }));
      fetchFiles(pagination.current_page);
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
    fetchFiles();
  }, [fetchFiles]);

  // 监听刷新触发器
  useEffect(() => {
    if (refreshTrigger && refreshTrigger > 0) {
      fetchFiles();
    }
  }, [refreshTrigger, fetchFiles]);

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
        rowKey="file_id"
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

const FilesPage: React.FC = () => {
  const { t } = useTranslation();
  const selectedMenu = 'file-list';
  const [workDirectory, setWorkDirectory] = useState<string>('workdir');
  const [importModalVisible, setImportModalVisible] = useState(false);
  const [selectedDirectory, setSelectedDirectory] = useState<string>('');
  const [importFilePath, setImportFilePath] = useState<string>('');
  const [directoryOptions, setDirectoryOptions] = useState<TreeNode[]>([]);
  const [manualSelectModalVisible, setManualSelectModalVisible] = useState(false);
  const [directoryTreeData, setDirectoryTreeData] = useState<TreeNode[]>([]);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // 文本文件扩展名列表
  const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.rst', '.json', '.xml', '.yaml', '.yml']);

  // 检查是否是文本文件
  const isTextFile = (filePath: string): boolean => {
    const extension = filePath.toLowerCase().substring(filePath.lastIndexOf('.'));
    return TEXT_EXTENSIONS.has(extension);
  };
  useEffect(() => {
    // 从store读取工作目录和设置
    const loadInitialData = async () => {
      if (window.electronStore) {
        try {
          const storedWorkDirectory = await window.electronStore.get('workDirectory') as string;
          
          if (storedWorkDirectory) {
            setWorkDirectory(storedWorkDirectory);
          } else {
            setWorkDirectory('workdir');
          }
        } catch (error) {
          console.error('Failed to load initial data:', error);
          setWorkDirectory('workdir');
        }
      } else {
        setWorkDirectory('workdir');
      }
    };

    loadInitialData();
  }, []);

  const handleImportFile = async () => {
    try {
      // 选择要导入的文件
      const filePath = await window.electronAPI.selectFile();
      if (!filePath) {
        return; // 用户取消了选择
      }

      // 步骤1: 获取工作目录的目录结构
      const directoryStructureResponse = await apiService.listDirectoryRecursive(workDirectory);
      if (!directoryStructureResponse.success) {
        message.error('获取目录结构失败');
        return;
      }

      // 提取目录路径列表
      const directories = extractDirectoriesFromStructure(directoryStructureResponse.data as DirectoryStructureResponse);

      // 步骤2: 调用推荐保存目录接口
      const loadingKey = message.loading('正在分析文件并推荐保存目录...', 0);
      const recommendResponse = await apiService.recommendDirectory(filePath, directories);
      loadingKey();
      
      if (!recommendResponse.success) {
        message.error('获取推荐目录失败');
        return;
      }

      const recommendedDirectory = (recommendResponse.data as RecommendDirectoryResponse)?.recommended_directory;
      const alternatives = (recommendResponse.data as RecommendDirectoryResponse)?.alternatives || [];

      // 步骤3: 获取设置选项 autoClassifyWithoutConfirmation
      const settings = await window.electronStore.get('settings') as Settings;
      const autoClassifyWithoutConfirmation = settings?.autoClassifyWithoutConfirmation || false;

      if (autoClassifyWithoutConfirmation) {
        // 步骤4: 自动保存到推荐目录
        const separator = getPathSeparator();
        const fullTargetDirectory = recommendedDirectory.startsWith(workDirectory) 
          ? recommendedDirectory 
          : `${workDirectory}${separator}${recommendedDirectory.replace(/\//g, separator)}`;
        
        const saveResponse = await apiService.saveFile(filePath, fullTargetDirectory, false);
        if (saveResponse.success) {
          message.success(`文件已自动保存到: ${recommendedDirectory}`);
          // 刷新文件列表
          setRefreshTrigger(prev => prev + 1);
          // 导入到RAG库
          const fileName = getFileName(filePath);
          const savedFilePath = `${fullTargetDirectory}${separator}${fileName}`;
          await handleRagImport(savedFilePath, isTextFile(filePath));
        } else {
          message.error(saveResponse.message || '文件保存失败');
        }
      } else {
        // 步骤5: 弹出确认对话框
        await showImportConfirmationDialog(filePath, recommendedDirectory, alternatives, directoryStructureResponse.data as DirectoryStructureResponse);
      }
    } catch (error) {
      message.error('文件导入失败');
      console.error(error);
    }
  };

  const getPathSeparator = () => {
    // 使用 userAgent 检测 Windows 平台，避免使用已弃用的 platform 属性
    return navigator.userAgent.includes('Windows') ? '\\' : '/';
  };

  // 提取文件名从路径
  const getFileName = (filePath: string) => {
    const separator = getPathSeparator();
    return filePath.split(separator).pop() || '';
  };

  // 处理RAG导入
  const handleRagImport = async (savedFilePath: string, noSaveDb: boolean = false) => {
    try {
      const settings = await window.electronStore.get('settings') as Settings;
      if (settings?.autoSaveRAG) {
        const loadingKey = message.loading('正在导入RAG库...', 0);
        const ragResponse = await apiService.importToRag(savedFilePath, noSaveDb);
        loadingKey();
        if (ragResponse.success) {
          message.success('文件已成功导入RAG库');
        } else {
          message.warning('文件保存成功，但导入RAG库失败');
        }
      }
    } catch (error) {
      message.warning('文件保存成功，但导入RAG库失败');
      console.error(error);
    }
  };

  // 从目录结构响应中提取目录路径列表
  const extractDirectoriesFromStructure = (structureData: DirectoryStructureResponse): string[] => {
    const directories: string[] = [];

    if (structureData && structureData.items) {
      for (const item of structureData.items) {
        if (item.type === 'folder' && item.relative_path && item.relative_path !== '.') {
          directories.push(item.relative_path);
        }
      }
    }

    return directories;
  };

  // 显示导入确认对话框
  const showImportConfirmationDialog = async (filePath: string, recommendedDirectory: string, alternatives: string[], directoryStructure: DirectoryStructureResponse) => {
    setImportFilePath(filePath);
    setSelectedDirectory(recommendedDirectory);

    // 构建选择数据，只包含推荐目录和备选目录
    const options = buildDirectoryOptions(recommendedDirectory, alternatives);
    setDirectoryOptions(options);

    // 构建完整的目录树数据
    const treeData = buildDirectoryTreeData(directoryStructure);
    setDirectoryTreeData(treeData);

    setImportModalVisible(true);
  };

  // 构建目录选择选项
  const buildDirectoryOptions = (recommendedDirectory: string, alternatives: string[]): TreeNode[] => {
    const options: TreeNode[] = [];

    // 添加推荐目录
    options.push({
      title: `${recommendedDirectory} (推荐)`,
      value: recommendedDirectory,
      key: recommendedDirectory,
      children: [],
    });

    // 添加备选目录
    alternatives.forEach(alt => {
      if (alt !== recommendedDirectory) { // 避免重复
        options.push({
          title: `${alt} (备选)`,
          value: alt,
          key: alt,
          children: [],
        });
      }
    });

    return options;
  };

  // 构建目录树数据
  const buildDirectoryTreeData = (structureData: DirectoryStructureResponse): TreeNode[] => {
    const treeData: TreeNode[] = [];
    const pathMap = new Map<string, TreeNode>();

    if (structureData && structureData.items) {
      // 首先创建所有节点
      structureData.items.forEach(item => {
        if (item.type === 'folder' && item.relative_path && item.relative_path !== '.') {
          const node: TreeNode = {
            title: item.name,
            value: item.relative_path,
            key: item.relative_path,
            children: [],
          };
          pathMap.set(item.relative_path, node);
        }
      });

      // 然后构建树结构
      pathMap.forEach((node, path) => {
        const parts = path.split('/');
        if (parts.length === 1) {
          // 根级目录
          treeData.push(node);
        } else {
          // 子目录
          const parentPath = parts.slice(0, -1).join('/');
          const parentNode = pathMap.get(parentPath);
          if (parentNode) {
            parentNode.children.push(node);
          }
        }
      });
    }

    return treeData;
  };

  // 处理导入确认
  const handleImportConfirm = async () => {
    if (!selectedDirectory) {
      message.error('请选择保存目录');
      return;
    }

    try {
      // 拼接完整的目标目录路径
      const separator = getPathSeparator();
      const fullTargetDirectory = selectedDirectory.startsWith(workDirectory) 
        ? selectedDirectory 
        : `${workDirectory}${separator}${selectedDirectory.replace(/\//g, separator)}`;
      
      const saveResponse = await apiService.saveFile(importFilePath, fullTargetDirectory, false);
      if (saveResponse.success) {
        message.success(`文件已保存到: ${selectedDirectory}`);
        setImportModalVisible(false);
        // 刷新文件列表
        setRefreshTrigger(prev => prev + 1);
        // 导入到RAG库
        const fileName = getFileName(importFilePath);
        const savedFilePath = `${fullTargetDirectory}${separator}${fileName}`;
        await handleRagImport(savedFilePath, isTextFile(importFilePath));
      } else {
        message.error(saveResponse.message || '文件保存失败');
      }
    } catch (error) {
      message.error('文件保存失败');
      console.error(error);
    }
  };

  // 处理导入取消
  const handleImportCancel = () => {
    setImportModalVisible(false);
    setSelectedDirectory('');
    setImportFilePath('');
  };

  // 处理手动选择目录
  const handleManualSelectDirectory = () => {
    setImportModalVisible(false); // 隐藏确认对话框
    setManualSelectModalVisible(true);
  };

  // 处理手动选择确认
  const handleManualSelectConfirm = async () => {
    if (!selectedDirectory) {
      message.error('请选择保存目录');
      return;
    }

    try {
      // 拼接完整的目标目录路径
      const separator = getPathSeparator();
      const fullTargetDirectory = selectedDirectory.startsWith(workDirectory)
        ? selectedDirectory
        : `${workDirectory}${separator}${selectedDirectory.replace(/\//g, separator)}`;

      const saveResponse = await apiService.saveFile(importFilePath, fullTargetDirectory, false);
      if (saveResponse.success) {
        message.success(`文件已保存到: ${selectedDirectory}`);
        setManualSelectModalVisible(false);
        // 刷新文件列表
        setRefreshTrigger(prev => prev + 1);
        // 导入到RAG库
        const fileName = getFileName(importFilePath);
        const savedFilePath = `${fullTargetDirectory}${separator}${fileName}`;
        await handleRagImport(savedFilePath, isTextFile(importFilePath));
      } else {
        message.error(saveResponse.message || '文件保存失败');
      }
    } catch (error) {
      message.error('文件保存失败');
      console.error(error);
    }
  };

  const handleRefresh = () => {
    setRefreshTrigger(prev => prev + 1);
  };

  // 处理手动选择取消
  const handleManualSelectCancel = () => {
    setManualSelectModalVisible(false);
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sidebar selectedMenu={selectedMenu} />
      <Layout style={{ padding: '0 24px 24px' }}>
        <Content
          style={{
            padding: 24,
            margin: 0,
            minHeight: 280,
            background: '#fff',
          }}
        >
          <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h1>文件管理</h1>
              <p>查看和管理已导入到系统的文件</p>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <Button
                icon={<ReloadOutlined />}
                onClick={handleRefresh}
                size="large"
              >
                刷新
              </Button>
              <Button
                type="primary"
                icon={<FileAddOutlined />}
                onClick={handleImportFile}
                size="large"
              >
                导入文件
              </Button>
            </div>
          </div>

          <FileList refreshTrigger={refreshTrigger} />
        </Content>
      </Layout>

      <Modal
        title="选择保存目录"
        open={importModalVisible}
        onOk={handleImportConfirm}
        onCancel={handleImportCancel}
        okText="确认保存"
        cancelText="取消"
        footer={[
          <Button key="cancel" onClick={handleImportCancel}>
            取消
          </Button>,
          <Button key="manual" onClick={handleManualSelectDirectory}>
            手动选择目录
          </Button>,
          <Button key="confirm" type="primary" onClick={handleImportConfirm}>
            确认保存
          </Button>,
        ]}
      >
        <div style={{ marginBottom: 16 }}>
          <p>系统推荐保存到: <strong>{selectedDirectory}</strong></p>
          <p>请选择要保存文件的目标目录：</p>
          <Select
            style={{ width: '100%' }}
            value={selectedDirectory}
            onChange={(value: string) => setSelectedDirectory(value)}
            placeholder="请选择目录"
          >
            {directoryOptions.map(option => (
              <Select.Option key={option.key} value={option.value}>
                {option.title}
              </Select.Option>
            ))}
          </Select>
        </div>
      </Modal>

      <Modal
        title="手动选择保存目录"
        open={manualSelectModalVisible}
        onOk={handleManualSelectConfirm}
        onCancel={handleManualSelectCancel}
        okText="确认选择"
        cancelText="取消"
        width={600}
      >
        <div style={{ marginBottom: 16 }}>
          <p>请选择要保存文件的目标目录：</p>
          <TreeSelect
            style={{ width: '100%' }}
            value={selectedDirectory}
            styles={{ popup: { root: { maxHeight: 400, overflow: 'auto' } } }}
            treeData={directoryTreeData}
            placeholder="请选择目录"
            treeDefaultExpandAll
            treeLine
            showSearch
            filterTreeNode={(input, treeNode) =>
              String(treeNode?.title).toLowerCase().includes(input.toLowerCase())
            }
            onChange={(value: string) => setSelectedDirectory(value)}
          />
        </div>
      </Modal>
    </Layout>
  );
};

export default FilesPage;