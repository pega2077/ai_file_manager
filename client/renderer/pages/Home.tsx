import { useState, useEffect } from 'react';
import { Layout, Table, Spin, message, Button } from 'antd';
import { ArrowUpOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { apiService } from '../services/api';
import Sidebar from '../components/Sidebar';

const { Content } = Layout;

declare global {
  interface Window {
    electronAPI: {
      selectFolder: () => Promise<string | null>;
      openFile: (filePath: string) => Promise<boolean>;
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

const Home = () => {
  const navigate = useNavigate();
  const [currentDirectory, setCurrentDirectory] = useState<string>('');
  const [workDirectory, setWorkDirectory] = useState<string>('');
  const [fileList, setFileList] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedMenu, setSelectedMenu] = useState('files');

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
    // 从store读取工作目录
    const loadWorkDirectory = async () => {
      if (window.electronStore) {
        try {
          const storedWorkDirectory = await window.electronStore.get('workDirectory') as string;
          console.log('Loaded workDirectory from store:', storedWorkDirectory);
          if (storedWorkDirectory) {
            setWorkDirectory(storedWorkDirectory);
            setCurrentDirectory(storedWorkDirectory);
          } else {
            // 如果没有设置工作目录，使用默认的workdir
            setWorkDirectory('workdir');
            setCurrentDirectory('workdir');
          }
        } catch (error) {
          console.error('Failed to load workDirectory from store:', error);
          setWorkDirectory('workdir');
          setCurrentDirectory('workdir');
        }
      } else {
        setWorkDirectory('workdir');
        setCurrentDirectory('workdir');
      }
    };

    loadWorkDirectory();
  }, []);

  useEffect(() => {
    if (currentDirectory) {
      loadDirectory(currentDirectory);
    }
  }, [currentDirectory]);

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
      // 打开文件
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
    </Layout>
  );
};

export default Home;