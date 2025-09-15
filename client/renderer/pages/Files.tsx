import React from 'react';
import { Layout, Button, message, Modal, Select, TreeSelect } from 'antd';
import { DatabaseOutlined, FileAddOutlined } from '@ant-design/icons';
import Sidebar from '../components/Sidebar';
import FileList from '../components/FileList';
import { useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { apiService } from '../services/api';

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

interface DirectoryStructureResponse {
  directory_path: string;
  items: DirectoryItem[];
  total_count: number;
}

interface RecommendDirectoryResponse {
  recommended_directory: string;
  alternatives: string[];
}

interface Settings {
  theme: string;
  language: string;
  autoSave: boolean;
  showHiddenFiles: boolean;
  enablePreview: boolean;
  autoClassifyWithoutConfirmation: boolean;
  autoSaveRAG: boolean;
  workDirectory: string;
}

const FilesPage: React.FC = () => {
  const navigate = useNavigate();
  const [selectedMenu, setSelectedMenu] = useState('file-list');
  const [workDirectory, setWorkDirectory] = useState<string>('workdir');
  const [importModalVisible, setImportModalVisible] = useState(false);
  const [selectedDirectory, setSelectedDirectory] = useState<string>('');
  const [importFilePath, setImportFilePath] = useState<string>('');
  const [directoryOptions, setDirectoryOptions] = useState<TreeNode[]>([]);
  const [manualSelectModalVisible, setManualSelectModalVisible] = useState(false);
  const [directoryTreeData, setDirectoryTreeData] = useState<TreeNode[]>([]);
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
          // 导入到RAG库
          const fileName = getFileName(filePath);
          const savedFilePath = `${fullTargetDirectory}${separator}${fileName}`;
          await handleRagImport(savedFilePath);
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
  const handleRagImport = async (savedFilePath: string) => {
    try {
      const settings = await window.electronStore.get('settings') as Settings;
      if (settings?.autoSaveRAG) {
        const loadingKey = message.loading('正在导入RAG库...', 0);
        const ragResponse = await apiService.importToRag(savedFilePath);
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
        // 导入到RAG库
        const fileName = getFileName(importFilePath);
        const savedFilePath = `${fullTargetDirectory}${separator}${fileName}`;
        await handleRagImport(savedFilePath);
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
        // 导入到RAG库
        const fileName = getFileName(importFilePath);
        const savedFilePath = `${fullTargetDirectory}${separator}${fileName}`;
        await handleRagImport(savedFilePath);
      } else {
        message.error(saveResponse.message || '文件保存失败');
      }
    } catch (error) {
      message.error('文件保存失败');
      console.error(error);
    }
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
        navigate('/home');
        break;
      case 'file-list':
        // 已经在文件列表页面，不需要跳转
        break;
      case 'search':
        navigate('/search');
        break;
      case 'settings':
        navigate('/settings');
        break;
      default:
        break;
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
          <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h1>文件管理</h1>
              <p>查看和管理已导入到系统的文件</p>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
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

          <FileList />
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