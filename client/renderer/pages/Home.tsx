import { useState, useEffect } from 'react';
import { Layout, Menu, Table, Spin, message } from 'antd';
import { FolderOutlined, SettingOutlined } from '@ant-design/icons';
import { apiService } from '../services/api';

const { Sider, Content } = Layout;

declare global {
  interface Window {
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
  const [currentDirectory, setCurrentDirectory] = useState<string>('');
  const [fileList, setFileList] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedMenu, setSelectedMenu] = useState('files');

  const menuItems = [
    {
      key: 'files',
      icon: <FolderOutlined />,
      label: '文件管理',
    },
    {
      key: 'settings',
      icon: <SettingOutlined />,
      label: '设置',
    },
  ];

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
          const workDirectory = await window.electronStore.get('workDirectory') as string;
          console.log('Loaded workDirectory from store:', workDirectory);
          if (workDirectory) {
            setCurrentDirectory(workDirectory);
          } else {
            // 如果没有设置工作目录，使用默认的workdir
            setCurrentDirectory('workdir');
          }
        } catch (error) {
          console.error('Failed to load workDirectory from store:', error);
          setCurrentDirectory('workdir');
        }
      } else {
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

  const handleMenuClick = ({ key }: { key: string }) => {
    setSelectedMenu(key);
    // TODO: Handle navigation for different menu items
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider width={200} style={{ background: '#fff' }}>
        <Menu
          mode="inline"
          selectedKeys={[selectedMenu]}
          style={{ height: '100%', borderRight: 0 }}
          items={menuItems}
          onClick={handleMenuClick}
        />
      </Sider>
      <Layout style={{ padding: '0 24px 24px' }}>
        <Content
          style={{
            padding: 24,
            margin: 0,
            minHeight: 280,
            background: '#fff',
          }}
        >
          <div style={{ marginBottom: 16 }}>
            <h2>当前目录: {currentDirectory}</h2>
          </div>
          <Spin spinning={loading}>
            <Table
              columns={columns}
              dataSource={fileList}
              rowKey="name"
              pagination={false}
            />
          </Spin>
        </Content>
      </Layout>
    </Layout>
  );
};

export default Home;