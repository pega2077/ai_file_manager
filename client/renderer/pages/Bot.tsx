import React, { useRef, useEffect, useState } from 'react';
import botLoadingImage from '../assets/mona-loading-default.gif';
import botStaticImage from '../assets/mona-loading-default-static.png';
import { message } from 'antd';
import { apiService } from '../services/api';

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

const Bot: React.FC = () => {
  const isDragging = useRef(false);
  const startPos = useRef({ x: 0, y: 0 });
  const [workDirectory, setWorkDirectory] = useState<string>('workdir');
  const [debugMessage, setDebugMessage] = useState<string>('');
  const [processing, setProcessing] = useState<boolean>(false);

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

  // 处理文件导入
  const handleFileImport = async (filePath: string) => {
    try {
      setProcessing(true);
      setDebugMessage(`Importing file: ${filePath}`);
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
          message.success(`文件已自动保存到: ${recommendedDirectory}`);
          // 导入到RAG库
          const fileName = getFileName(filePath);
          const savedFilePath = `${fullTargetDirectory}${separator}${fileName}`;
          await handleRagImport(savedFilePath);
        } else {
          message.error(saveResponse.message || '文件保存失败');
        }
      } else {
        // 对于Bot窗口，我们直接保存到推荐目录，不显示确认对话框
        const separator = getPathSeparator();
        const fullTargetDirectory = recommendedDirectory.startsWith(workDirectory) 
          ? recommendedDirectory 
          : `${workDirectory}${separator}${recommendedDirectory.replace(/\//g, separator)}`;
        
        const saveResponse = await apiService.saveFile(filePath, fullTargetDirectory, false);
        if (saveResponse.success) {
          message.success(`文件已保存到: ${recommendedDirectory}`);
          // 导入到RAG库
          const fileName = getFileName(filePath);
          const savedFilePath = `${fullTargetDirectory}${separator}${fileName}`;
          await handleRagImport(savedFilePath);
        } else {
          message.error(saveResponse.message || '文件保存失败');
        }
      }
    } catch (error) {
      message.error('文件导入失败');
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
      message.error('Error processing files');
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
      <div>{debugMessage}</div>
    </div>
  );
};

export default Bot;