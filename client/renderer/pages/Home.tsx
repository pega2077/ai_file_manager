import { useState, useEffect } from 'react';
import { Layout, Table, Spin, message, Button } from 'antd';
import { ArrowUpOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { apiService } from '../services/api';
import Sidebar from '../components/Sidebar';
import FilePreview from '../components/FilePreview';

const { Content } = Layout;

declare global {
  interface Window {
    electronAPI: {
      selectFolder: () => Promise<string | null>;
      openFile: (filePath: string) => Promise<boolean>;
      openFolder: (filePath: string) => Promise<boolean>;
      selectFile: () => Promise<string | null>;
    };
    electronStore: {
      get: (key: string) => Promise<unknown>;
      set: (key: string, value: unknown) => Promise<void>;
      delete: (key: string) => Promise<void>;
      has: (key: string) => Promise<boolean>;
    };
  }
}

interface FileItem {
  name: string;
  type: 'file' | 'folder';
  size: number | null;
  created_at: string | null;
  modified_at: string | null;
  item_count: number | null;
}

interface DirectoryResponse {
  directory_path: string;
  items: FileItem[];
  total_count: number;
}

interface ImportFileResponse {
  file_id: string;
  name: string;
  path: string;
  type: string;
  size: number;
  category: string;
  summary: string;
  tags: string[];
  added_at: string;
  processed: boolean;
}

interface Settings {
  theme: string;
  language: string;
  autoSave: boolean;
  showHiddenFiles: boolean;
  enablePreview: boolean;
  workDirectory: string;
}

const Home = () => {
  const navigate = useNavigate();
  const [currentDirectory, setCurrentDirectory] = useState<string>('');
  const [workDirectory, setWorkDirectory] = useState<string>('');
  const [fileList, setFileList] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedMenu, setSelectedMenu] = useState('files');
  const [enablePreview, setEnablePreview] = useState(true);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewFile, setPreviewFile] = useState<{ path: string; name: string } | null>(null);

  const columns = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      render: (text: string, record: FileItem) => (
        <span>
          {record.type === 'folder' ? '📁 ' : '📄 '}
          {text}
        </span>
      ),
    },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      render: (type: string) => type === 'folder' ? '文件夹' : '文件',
    },
    {
      title: '大小',
      dataIndex: 'size',
      key: 'size',
      render: (size: number | null) => {
        if (size === null) return '-';
        if (size === 0) return '0 B';

        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let unitIndex = 0;
        let formattedSize = size;

        while (formattedSize >= 1024 && unitIndex < units.length - 1) {
          formattedSize /= 1024;
          unitIndex++;
        }

        return `${formattedSize.toFixed(1)} ${units[unitIndex]}`;
      },
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (date: string | null) => date ? new Date(date).toLocaleString() : '-',
    },
    {
      title: '修改时间',
      dataIndex: 'modified_at',
      key: 'modified_at',
      render: (date: string | null) => date ? new Date(date).toLocaleString() : '-',
    },
    {
      title: '操作',
      key: 'actions',
      render: (_text: string, record: FileItem) => (
        <div style={{ display: 'flex', gap: '8px' }}>
          {record.type === 'file' && (
            <Button
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                handlePreview(record);
              }}
            >
              预览
            </Button>
          )}
          <Button
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              handleOpenFolder(record);
            }}
          >
            打开文件夹
          </Button>
          <Button
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              handleOpenFile(record);
            }}
          >
            直接打开
          </Button>
        </div>
      ),
    },
  ];

  const loadDirectory = async (directoryPath: string) => {
    setLoading(true);
    try {
      const response = await apiService.listDirectory(directoryPath) as { success: boolean; data: DirectoryResponse; message: string };
      if (response.success) {
        setFileList(response.data.items);
        setCurrentDirectory(directoryPath);
      } else {
        message.error(response.message || '加载目录失败');
      }
    } catch (error) {
      message.error('加载目录失败');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // 从store读取工作目录和设置
    const loadInitialData = async () => {
      if (window.electronStore) {
        try {
          const storedWorkDirectory = await window.electronStore.get('workDirectory') as string;
          const settings = await window.electronStore.get('settings') as Settings;
          
          if (storedWorkDirectory) {
            setWorkDirectory(storedWorkDirectory);
            setCurrentDirectory(storedWorkDirectory);
          } else {
            setWorkDirectory('workdir');
            setCurrentDirectory('workdir');
          }
          
          if (settings && typeof settings.enablePreview === 'boolean') {
            setEnablePreview(settings.enablePreview);
          }
        } catch (error) {
          console.error('Failed to load initial data:', error);
          setWorkDirectory('workdir');
          setCurrentDirectory('workdir');
        }
      } else {
        setWorkDirectory('workdir');
        setCurrentDirectory('workdir');
      }
    };

    loadInitialData();
  }, []);

  useEffect(() => {
    if (currentDirectory) {
      loadDirectory(currentDirectory);
    }
  }, [currentDirectory]);

  const handlePreview = (record: FileItem) => {
    const separator = getPathSeparator();
    const fullPath = `${currentDirectory}${separator}${record.name}`;
    setPreviewFile({ path: fullPath, name: record.name });
    setPreviewVisible(true);
  };

  const handleOpenFolder = async (record: FileItem) => {
    const separator = getPathSeparator();
    const fullPath = `${currentDirectory}${separator}${record.name}`;
    try {
      const success = await window.electronAPI.openFolder(fullPath);
      if (!success) {
        message.error('无法打开文件夹');
      }
    } catch (error) {
      message.error('打开文件夹失败');
      console.error(error);
    }
  };

  const handleOpenFile = async (record: FileItem) => {
    const separator = getPathSeparator();
    const fullPath = `${currentDirectory}${separator}${record.name}`;
    try {
      const success = await window.electronAPI.openFile(fullPath);
      if (!success) {
        message.error('无法打开文件');
      }
    } catch (error) {
      message.error('打开文件失败');
      console.error(error);
    }
  };

  const handleImportFile = async () => {
    try {
      // 选择要导入的文件
      const filePath = await window.electronAPI.selectFile();
      if (!filePath) {
        return; // 用户取消了选择
      }

      // 调用API导入文件
      const response = await apiService.importFile(filePath);
      if (response.success) {
        const fileData = response.data as ImportFileResponse;
        const fileName = fileData?.name || '文件';
        message.success(`文件导入成功: ${fileName}`);
        // 刷新当前目录列表
        loadDirectory(currentDirectory);
      } else {
        message.error(response.message || '文件导入失败');
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

  const handleMenuClick = ({ key }: { key: string }) => {
    setSelectedMenu(key);

    // 根据菜单项导航到不同页面
    switch (key) {
      case 'files':
        // 已经在文件管理页面，不需要跳转
        break;
      case 'settings':
        navigate('/settings');
        break;
      default:
        break;
    }
  };

  const handleGoUp = () => {
    if (currentDirectory === workDirectory) {
      return; // 已经在工作区根目录，无法返回上级
    }

    // 根据平台选择分隔符来分割路径
    const separator = getPathSeparator();
    const pathParts = currentDirectory.split(separator);
    
    // 移除最后一个部分（当前目录名）
    pathParts.pop();
    
    // 重新拼接路径
    const parentPath = pathParts.join(separator);
    
    if (parentPath) {
      setCurrentDirectory(parentPath);
    }
  };

  const handleRowDoubleClick = async (record: FileItem) => {
    // 根据平台选择合适的分隔符
    const separator = getPathSeparator();
    const fullPath = `${currentDirectory}${separator}${record.name}`;

    if (record.type === 'folder') {
      // 切换到子目录
      setCurrentDirectory(fullPath);
    } else {
      // 根据设置决定是预览还是直接打开
      if (enablePreview) {
        // 启用预览，显示预览模态框
        setPreviewFile({ path: fullPath, name: record.name });
        setPreviewVisible(true);
      } else {
        // 直接打开文件
        try {
          const success = await window.electronAPI.openFile(fullPath);
          if (!success) {
            message.error('无法打开文件');
          }
        } catch (error) {
          message.error('打开文件失败');
          console.error(error);
        }
      }
    }
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sidebar selectedMenu={selectedMenu} onMenuClick={handleMenuClick} />
      <Layout style={{ padding: '0 24px 24px' }}>
        <Content
          style={{
            padding: 24,
            margin: 0,
            minHeight: 280,
            background: '#fff',
          }}
        >
          <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: '16px' }}>
            <h2 style={{ margin: 0 }}>当前目录: {currentDirectory}</h2>
            <Button
              icon={<ArrowUpOutlined />}
              onClick={handleGoUp}
              disabled={currentDirectory === workDirectory}
              title="返回上级目录"
            >
              返回上级
            </Button>
            <Button
              type="primary"
              onClick={handleImportFile}
              title="导入文件到工作区"
            >
              导入文件
            </Button>
          </div>
          <Spin spinning={loading}>
            <Table
              columns={columns}
              dataSource={fileList}
              rowKey="name"
              pagination={false}
              onRow={(record) => ({
                onDoubleClick: () => handleRowDoubleClick(record),
              })}
            />
          </Spin>
        </Content>
      </Layout>
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
    </Layout>
  );
};

export default Home;