import React, { useRef, useEffect, useState } from 'react';
import botLoadingImage from '../assets/mona-loading-default.gif';
import botStaticImage from '../assets/mona-loading-default-static.png';
import { message, Modal, Select, TreeSelect, Button, Menu } from 'antd';
import { apiService } from '../services/api';
import { DirectoryItem, DirectoryStructureResponse, RecommendDirectoryResponse, Settings, TreeNode } from '../shared/types';
import { isTextFile } from '../shared/utils';
import { useTranslation } from '../shared/i18n/I18nProvider';

const Bot: React.FC = () => {
  const { t } = useTranslation();
  const isDragging = useRef(false);
  const startPos = useRef({ x: 0, y: 0 });
  const [workDirectory, setWorkDirectory] = useState<string>('workdir');
  const [debugMessage, setDebugMessage] = useState<string>('');
  const [processing, setProcessing] = useState<boolean>(false);
  const [importModalVisible, setImportModalVisible] = useState(false);
  const [selectedDirectory, setSelectedDirectory] = useState<string>('');
  const [importFilePath, setImportFilePath] = useState<string>('');
  const [directoryOptions, setDirectoryOptions] = useState<TreeNode[]>([]);
  const [manualSelectModalVisible, setManualSelectModalVisible] = useState(false);
  const [directoryTreeData, setDirectoryTreeData] = useState<TreeNode[]>([]);
  const [menuVisible, setMenuVisible] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });

  useEffect(() => {
    // 从store读取工作目录
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

  const handleDoubleClick = async () => {
    try {
      await window.electronAPI.showMainWindow();
    } catch (error) {
      console.error('Failed to show main window:', error);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setMenuPosition({ x: e.clientX, y: e.clientY });
    setMenuVisible(true);
  };

  const handleMenuClick = async (key: string) => {
    setMenuVisible(false);
    if (key === 'showMain') {
      try {
        await window.electronAPI.showMainWindow();
      } catch (error) {
        console.error('Failed to show main window:', error);
      }
    } else if (key === 'hideBot') {
      try {
        await window.electronAPI.hideBotWindow();
      } catch (error) {
        console.error('Failed to hide bot window:', error);
      }
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    isDragging.current = true;
    startPos.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging.current) return;
    const deltaX = e.clientX - startPos.current.x;
    const deltaY = e.clientY - startPos.current.y;
    window.electronAPI.moveBotWindow(deltaX, deltaY);
  };

  const handleMouseUp = () => {
    isDragging.current = false;
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
        const loadingKey = message.loading(t('bot.messages.importingToRag'), 0);
        const ragResponse = await apiService.importToRag(savedFilePath, noSaveDb);
        loadingKey();
        if (ragResponse.success) {
          message.success(t('bot.messages.importedToRagSuccess'));
        } else {
          message.warning(t('bot.messages.saveSuccessRagFailed'));
        }
      }
    } catch (error) {
      message.warning(t('bot.messages.saveSuccessRagFailed'));
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
      message.error(t('bot.messages.selectSaveDirectory'));
      return;
    }

    // 隐藏弹框并开启loading动画
    setImportModalVisible(false);
    setProcessing(true);

    try {
      // 拼接完整的目标目录路径
      const separator = getPathSeparator();
      const fullTargetDirectory = selectedDirectory.startsWith(workDirectory) 
        ? selectedDirectory 
        : `${workDirectory}${separator}${selectedDirectory.replace(/\//g, separator)}`;
      
      const saveResponse = await apiService.saveFile(importFilePath, fullTargetDirectory, false);
      if (saveResponse.success) {
        message.success(t('bot.messages.fileSavedTo', { path: selectedDirectory }));
        // 导入到RAG库
        const fileName = getFileName(importFilePath);
        const savedFilePath = `${fullTargetDirectory}${separator}${fileName}`;
        await handleRagImport(savedFilePath, isTextFile(importFilePath));
      } else {
        message.error(saveResponse.message || t('bot.messages.fileSaveFailed'));
      }
    } catch (error) {
      message.error(t('bot.messages.fileSaveFailed'));
      console.error(error);
    } finally {
      setProcessing(false);
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
      message.error(t('bot.messages.selectSaveDirectory'));
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
        message.success(t('bot.messages.fileSavedTo', { path: selectedDirectory }));
        setManualSelectModalVisible(false);
        // 导入到RAG库
        const fileName = getFileName(importFilePath);
        const savedFilePath = `${fullTargetDirectory}${separator}${fileName}`;
        await handleRagImport(savedFilePath, isTextFile(importFilePath));
      } else {
        message.error(saveResponse.message || t('bot.messages.fileSaveFailed'));
      }
    } catch (error) {
      message.error(t('bot.messages.fileSaveFailed'));
      console.error(error);
    }
  };

  // 处理手动选择取消
  const handleManualSelectCancel = () => {
    setManualSelectModalVisible(false);
  };

  // 处理文件导入
  const handleFileImport = async (filePath: string) => {
    try {
      setProcessing(true);
      setDebugMessage(`Importing file: ${filePath}`);
      // 步骤1: 获取工作目录的目录结构
      const directoryStructureResponse = await apiService.listDirectoryRecursive(workDirectory);
      if (!directoryStructureResponse.success) {
        message.error(t('bot.messages.getDirectoryStructureFailed'));
        return;
      }

      // 提取目录路径列表
      const directories = extractDirectoriesFromStructure(directoryStructureResponse.data as DirectoryStructureResponse);

      // 步骤2: 调用推荐保存目录接口
      const loadingKey = message.loading(t('bot.messages.analyzingFile'), 0);
      const recommendResponse = await apiService.recommendDirectory(filePath, directories);
      loadingKey();
      
      if (!recommendResponse.success) {
        message.error(t('bot.messages.getRecommendationFailed'));
        return;
      }

      const recommendedDirectory = (recommendResponse.data as RecommendDirectoryResponse)?.recommended_directory;

      // 步骤3: 获取设置选项 autoClassifyWithoutConfirmation
      const settings = await window.electronStore.get('settings') as Settings;
      const autoClassifyWithoutConfirmation = settings?.autoClassifyWithoutConfirmation || false;
      setDebugMessage(`Recommended directory: ${recommendedDirectory}, Auto classify without confirmation: ${autoClassifyWithoutConfirmation}`);
      if (autoClassifyWithoutConfirmation) {
        // 步骤4: 自动保存到推荐目录
        const separator = getPathSeparator();
        const fullTargetDirectory = recommendedDirectory.startsWith(workDirectory) 
          ? recommendedDirectory 
          : `${workDirectory}${separator}${recommendedDirectory.replace(/\//g, separator)}`;
        
        const saveResponse = await apiService.saveFile(filePath, fullTargetDirectory, false);
        if (saveResponse.success) {
          message.success(t('bot.messages.fileAutoSavedTo', { path: recommendedDirectory }));
          // 导入到RAG库
          const fileName = getFileName(filePath);
          const savedFilePath = `${fullTargetDirectory}${separator}${fileName}`;
          await handleRagImport(savedFilePath, isTextFile(filePath));
        } else {
          message.error(saveResponse.message || t('bot.messages.fileSaveFailed'));
        }
      } else {
        // 步骤5: 弹出确认对话框
        const alternatives = (recommendResponse.data as RecommendDirectoryResponse)?.alternatives || [];
        await showImportConfirmationDialog(filePath, recommendedDirectory, alternatives, directoryStructureResponse.data as DirectoryStructureResponse);
      }
    } catch (error) {
      message.error(t('bot.messages.fileImportFailed'));
      console.error(error);
    } finally {
      setProcessing(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault(); // Allow drop
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    console.log('Drop event:', e);

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    try {
      const filePaths = await Promise.all(
        files.map(async (file) => {
          try {
            return window.webUtils.getPathForFile(file);
          } catch (error) {
            console.error('Failed to get path for file:', file.name, error);
            return null;
          }
        })
      ).then(paths => paths.filter((path): path is string => path !== null));

      if (filePaths.length > 0) {
        console.log('Dropped files:', filePaths);
        const toastMessage = files.length === 1
          ? `FilePath: ${filePaths[0]}`
          : `${files.length} files dropped`;

        message.info(toastMessage);

        // Set processing state
        setProcessing(true);

        // Process the dropped files
        for (const filePath of filePaths) {
          await handleFileImport(filePath);
        }

        // Reset processing state after all files are processed
        setProcessing(false);
      }
    } catch (error) {
      console.error('Error processing dropped files:', error);
      message.error(t('bot.messages.errorProcessingFiles'));
      setProcessing(false);
    }
  };

  useEffect(() => {
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // 处理点击其他区域隐藏菜单
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuVisible) {
        const menuElement = document.querySelector('.context-menu');
        if (menuElement && !menuElement.contains(e.target as Node)) {
          setMenuVisible(false);
        }
      }
    };

    if (menuVisible) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [menuVisible]);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      height: '100vh',
      width: '100vw',
      position: 'relative'
    }}>
      <img
        id="bot-image"
        src={processing ? botLoadingImage : botStaticImage}
        alt="Bot"
        onDoubleClick={handleDoubleClick}
        onMouseDown={handleMouseDown}
        onContextMenu={handleContextMenu}
        onDragStart={(e) => e.preventDefault()}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        draggable={false}
        style={{
          width: '200px',
          height: '200px',
          cursor: 'pointer'
        }}
      />
      {/* <div>{debugMessage}</div> */}
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

      {menuVisible && (
        <div
          className="context-menu"
          style={{
            position: 'fixed',
            top: menuPosition.y,
            left: menuPosition.x,
            zIndex: 1000,
            background: 'white',
            border: '1px solid #ccc',
            borderRadius: '4px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          }}
          onClick={() => setMenuVisible(false)}
        >
          <Menu onClick={({ key }) => handleMenuClick(key as string)}>
            <Menu.Item key="showMain">显示主窗口</Menu.Item>
            <Menu.Item key="hideBot">隐藏机器人</Menu.Item>
          </Menu>
        </div>
      )}
    </div>
  );
};

export default Bot;