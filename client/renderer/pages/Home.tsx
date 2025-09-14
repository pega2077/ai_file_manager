import { useState, useEffect } from 'react';
import { Layout, Table, Spin, message, Button, Modal, Select, TreeSelect } from 'antd';
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

interface DirectoryItem {
  name: string;
  type: 'file' | 'folder';
  path?: string;
  relative_path?: string;
  depth?: number;
  size?: number;
  created_at?: string;
  modified_at?: string;
  item_count?: number;
  children?: DirectoryItem[];
}

interface TreeNode {
  title: string;
  value: string;
  key: string;
  children: TreeNode[];
}

interface DirectoryResponse {
  directory_path: string;
  items: FileItem[];
  total_count: number;
}

interface DirectoryStructureResponse {
  directory_path: string;
  items: DirectoryItem[];
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
  autoClassifyWithoutConfirmation: boolean;
  workDirectory: string;
}

const Home = () => {
  const navigate = useNavigate();
  const [currentDirectory, setCurrentDirectory] = useState<string>('');
  const [workDirectory, setWorkDirectory] = useState<string>('');
  const [fileList, setFileList] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [importModalVisible, setImportModalVisible] = useState(false);
  const [selectedDirectory, setSelectedDirectory] = useState<string>('');
  const [importFilePath, setImportFilePath] = useState<string>('');
  const [directoryOptions, setDirectoryOptions] = useState<TreeNode[]>([]);
  const [manualSelectModalVisible, setManualSelectModalVisible] = useState(false);
  const [directoryTreeData, setDirectoryTreeData] = useState<TreeNode[]>([]);
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

      // 步骤1: 获取工作目录的目录结构
      const directoryStructureResponse = await apiService.listDirectoryRecursive(workDirectory);
      if (!directoryStructureResponse.success) {
        message.error('获取目录结构失败');
        return;
      }

      // 提取目录路径列表
      const directories = extractDirectoriesFromStructure(directoryStructureResponse.data as DirectoryStructureResponse);

      // 步骤2: 调用推荐保存目录接口
      const recommendResponse = await apiService.recommendDirectory(filePath, directories);
      if (!recommendResponse.success) {
        message.error('获取推荐目录失败');
        return;
      }

      const recommendedDirectory = recommendResponse.data?.recommended_directory;
      const alternatives = recommendResponse.data?.alternatives || [];

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
          // 刷新当前目录列表
          loadDirectory(currentDirectory);
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
        loadDirectory(currentDirectory);
        setImportModalVisible(false);
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
    setManualSelectModalVisible(true);
  };

  // 处理手动选择确认
  const handleManualSelectConfirm = () => {
    setManualSelectModalVisible(false);
    // selectedDirectory 已经在TreeSelect的onChange中设置了
  };

  // 处理手动选择取消
  const handleManualSelectCancel = () => {
    setManualSelectModalVisible(false);
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
            dropdownStyle={{ maxHeight: 400, overflow: 'auto' }}
            treeData={directoryTreeData}
            placeholder="请选择目录"
            treeDefaultExpandAll
            onChange={(value: string) => setSelectedDirectory(value)}
          />
        </div>
      </Modal>
    </Layout>
  );
};

export default Home;