import { useState, useEffect } from 'react';
import { Layout, Table, Spin, message, Button, Modal, Select, TreeSelect } from 'antd';
import { ArrowUpOutlined, EyeOutlined, FolderOpenOutlined, FileTextOutlined, DatabaseOutlined } from '@ant-design/icons';
import { apiService } from '../services/api';
import Sidebar from '../components/Sidebar';
import FilePreview from '../components/FilePreview';
import { DirectoryItem, DirectoryStructureResponse, Settings, TreeNode, FileItem, DirectoryResponse, ImportFileResponse } from '../shared/types';
import { useTranslation } from '../shared/i18n/I18nProvider';

const { Content } = Layout;

const Home = () => {
  const { t } = useTranslation();
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
  const selectedMenu = 'files';
  const [enablePreview, setEnablePreview] = useState(true);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewFile, setPreviewFile] = useState<{ path: string; name: string } | null>(null);

  const columns = [
    {
      title: t('home.table.columns.name'),
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
      title: t('home.table.columns.type'),
      dataIndex: 'type',
      key: 'type',
      render: (type: string) => type === 'folder' ? t('home.table.type.folder') : t('home.table.type.file'),
    },
    {
      title: t('home.table.columns.size'),
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
      title: t('home.table.columns.createdAt'),
      dataIndex: 'created_at',
      key: 'created_at',
      render: (date: string | null) => date ? new Date(date).toLocaleString() : '-',
    },
    {
      title: t('home.table.columns.modifiedAt'),
      dataIndex: 'modified_at',
      key: 'modified_at',
      render: (date: string | null) => date ? new Date(date).toLocaleString() : '-',
    },
    {
      title: t('home.table.columns.actions'),
      key: 'actions',
      render: (_text: string, record: FileItem) => (
        <div style={{ display: 'flex', gap: '4px' }}>
          {record.type === 'file' && (
            <>
              <Button
                type="text"
                size="small"
                icon={<EyeOutlined />}
                onClick={(e) => {
                  e.stopPropagation();
                  handlePreview(record);
                }}
                title={t('home.actions.preview')}
              />
              <Button
                type="text"
                size="small"
                icon={<DatabaseOutlined />}
                onClick={(e) => {
                  e.stopPropagation();
                  handleImportToRag(record);
                }}
                title={t('home.actions.importToRag')}
              />
            </>
          )}
          <Button
            type="text"
            size="small"
            icon={<FolderOpenOutlined />}
            onClick={(e) => {
              e.stopPropagation();
              handleOpenFolder(record);
            }}
            title={t('home.actions.openFolder')}
          />
          <Button
            type="text"
            size="small"
            icon={<FileTextOutlined />}
            onClick={(e) => {
              e.stopPropagation();
              handleOpenFile(record);
            }}
            title={t('home.actions.openFile')}
          />
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
        message.error(response.message || t('home.messages.loadDirectoryFailed'));
      }
    } catch (error) {
      message.error(t('home.messages.loadDirectoryFailed'));
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

  const handleImportToRag = async (record: FileItem) => {
    if (record.type !== 'file') return;
    const separator = getPathSeparator();
    const fullPath = `${currentDirectory}${separator}${record.name}`;

    try {
      const loadingKey = message.loading(t('home.messages.importingToRag'), 0);
      // Save the file to ensure a file_id exists in DB (overwrite to avoid duplicates)
      const saveResp = await apiService.saveFile(fullPath, currentDirectory, true);
      const fileId = (saveResp.data as { file_id?: string } | undefined)?.file_id;
      if (!saveResp.success || !fileId) {
        loadingKey();
        message.error(saveResp.message || t('home.messages.importToRagFailed'));
        return;
      }
      // Now import to RAG using file_id
      await handleRagImport(fileId);
      loadingKey();
    } catch (error) {
      message.error(t('home.messages.importToRagFailed'));
      console.error(error);
    }
  };

  const handleOpenFolder = async (record: FileItem) => {
    const separator = getPathSeparator();
    const fullPath = `${currentDirectory}${separator}${record.name}`;
    try {
      const success = await window.electronAPI.openFolder(fullPath);
      if (!success) {
        message.error(t('home.messages.cannotOpenFolder'));
      }
    } catch (error) {
      message.error(t('home.messages.openFolderFailed'));
      console.error(error);
    }
  };

  const handleOpenFile = async (record: FileItem) => {
    const separator = getPathSeparator();
    const fullPath = `${currentDirectory}${separator}${record.name}`;
    try {
      const success = await window.electronAPI.openFile(fullPath);
      if (!success) {
        message.error(t('home.messages.cannotOpenFile'));
      }
    } catch (error) {
      message.error(t('home.messages.openFileFailed'));
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
        message.error(t('home.messages.getDirectoryStructureFailed'));
        return;
      }

      // 提取目录路径列表
      const directories = extractDirectoriesFromStructure(directoryStructureResponse.data as DirectoryStructureResponse);

      // 步骤2: 调用推荐保存目录接口
      const loadingKey = message.loading(t('home.messages.analyzingFile'), 0);
      const recommendResponse = await apiService.recommendDirectory(filePath, directories);
      loadingKey();
      
      if (!recommendResponse.success) {
        message.error(t('home.messages.getRecommendationFailed'));
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
          message.success(t('home.messages.fileAutoSavedTo', { path: recommendedDirectory }));
          // 刷新当前目录列表
          loadDirectory(currentDirectory);
          // 导入到RAG库：使用 saveFile 返回的 file_id
          const fileId = (saveResponse.data as { file_id?: string } | undefined)?.file_id;
          if (fileId) {
            await handleRagImport(fileId);
          } else {
            message.warning(t('home.messages.saveSuccessRagFailed'));
          }
        } else {
          message.error(saveResponse.message || t('home.messages.fileSaveFailed'));
        }
      } else {
        // 步骤5: 弹出确认对话框
        await showImportConfirmationDialog(filePath, recommendedDirectory, alternatives, directoryStructureResponse.data as DirectoryStructureResponse);
      }
    } catch (error) {
      message.error(t('home.messages.fileImportFailed'));
      console.error(error);
    }
  };

  const getPathSeparator = () => {
    // 使用 userAgent 检测 Windows 平台，避免使用已弃用的 platform 属性
    return navigator.userAgent.includes('Windows') ? '\\' : '/';
  };

  // 文件名解析不再需要；RAG 导入基于 file_id

  // 处理RAG导入
  const handleRagImport = async (fileId: string) => {
    try {
      const settings = await window.electronStore.get('settings') as Settings;
      if (settings?.autoSaveRAG) {
        const loadingKey = message.loading(t('home.messages.importingRag'), 0);
        const ragResponse = await apiService.importToRag(fileId);
        loadingKey();
        if (ragResponse.success) {
          message.success(t('home.messages.importedRagSuccess'));
        } else {
          message.warning(t('home.messages.saveSuccessRagFailed'));
        }
      }
    } catch (error) {
      message.warning(t('home.messages.saveSuccessRagFailed'));
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
      title: `${recommendedDirectory} ${t('files.import.suffixRecommended')}`,
      value: recommendedDirectory,
      key: recommendedDirectory,
      children: [],
    });

    // 添加备选目录
    alternatives.forEach(alt => {
      if (alt !== recommendedDirectory) { // 避免重复
        options.push({
          title: `${alt} ${t('files.import.suffixAlternative')}`,
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
      message.error(t('home.import.selectSaveDirectory'));
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
        message.success(t('home.import.fileSavedTo', { path: selectedDirectory }));
        loadDirectory(currentDirectory);
        setImportModalVisible(false);
        // 导入到RAG库：使用 saveFile 返回的 file_id
        const fileId = (saveResponse.data as { file_id?: string } | undefined)?.file_id;
        if (fileId) {
          await handleRagImport(fileId);
        } else {
          message.warning(t('home.messages.saveSuccessRagFailed'));
        }
      } else {
        message.error(saveResponse.message || t('home.import.fileSaveFailed'));
      }
    } catch (error) {
      message.error(t('home.import.fileSaveFailed'));
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
      message.error(t('home.import.selectSaveDirectory'));
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
        message.success(t('home.import.fileSavedTo', { path: selectedDirectory }));
        loadDirectory(currentDirectory);
        setManualSelectModalVisible(false);
        // 导入到RAG库：使用 saveFile 返回的 file_id
        const fileId = (saveResponse.data as { file_id?: string } | undefined)?.file_id;
        if (fileId) {
          await handleRagImport(fileId);
        } else {
          message.warning(t('home.messages.saveSuccessRagFailed'));
        }
      } else {
        message.error(saveResponse.message || t('home.import.fileSaveFailed'));
      }
    } catch (error) {
      message.error(t('home.import.fileSaveFailed'));
      console.error(error);
    }
  };

  // 处理手动选择取消
  const handleManualSelectCancel = () => {
    setManualSelectModalVisible(false);
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
            message.error(t('home.messages.cannotOpenFile'));
          }
        } catch (error) {
          message.error(t('home.messages.openFileFailed'));
          console.error(error);
        }
      }
    }
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
          <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: '16px' }}>
              <Button
                icon={<ArrowUpOutlined />}
                onClick={handleGoUp}
                disabled={currentDirectory === workDirectory}
                title={t('home.buttonTitles.goUp')}
              >
                {t('home.buttons.goUp')}
              </Button>
              <Button
                type="primary"
                onClick={handleImportFile}
                title={t('home.buttonTitles.importFile')}
              >
                {t('home.buttons.importFile')}
              </Button>
              <h2 style={{ margin: 0 }}>{t('home.currentDirectory', { path: currentDirectory })}</h2>
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
          title={t('home.import.modalTitle')}
          open={importModalVisible}
          onOk={handleImportConfirm}
          onCancel={handleImportCancel}
          okText={t('home.import.confirmSave')}
          cancelText={t('common.cancel')}
          footer={[
            <Button key="cancel" onClick={handleImportCancel}>
              {t('common.cancel')}
            </Button>,
            <Button key="manual" onClick={handleManualSelectDirectory}>
              {t('home.import.manualSelectButton')}
            </Button>,
            <Button key="confirm" type="primary" onClick={handleImportConfirm}>
              {t('home.import.confirmSave')}
            </Button>,
          ]}
        >
          <div style={{ marginBottom: 16 }}>
            <p>{t('home.import.recommendText', { path: selectedDirectory })}</p>
            <p>{t('home.import.selectTargetPrompt')}</p>
            <Select
              style={{ width: '100%' }}
              value={selectedDirectory}
              onChange={(value: string) => setSelectedDirectory(value)}
              placeholder={t('home.import.selectPlaceholder')}
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
          title={t('home.import.manualModalTitle')}
          open={manualSelectModalVisible}
          onOk={handleManualSelectConfirm}
          onCancel={handleManualSelectCancel}
          okText={t('home.import.confirmSelect')}
          cancelText={t('common.cancel')}
          width={600}
        >
          <div style={{ marginBottom: 16 }}>
            <p>{t('home.import.selectTargetPrompt')}</p>
            <TreeSelect
              style={{ width: '100%' }}
              value={selectedDirectory}
              styles={{ popup: { root: { maxHeight: 400, overflow: 'auto' } } }}
              treeData={directoryTreeData}
              placeholder={t('home.import.selectPlaceholder')}
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

export default Home;