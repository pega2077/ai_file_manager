import React, { useRef, useEffect, useState } from 'react';
import botLoadingImage from '../assets/mona-loading-default.gif';
import botStaticImage from '../assets/mona-loading-default-static.png';
import { message, Menu } from 'antd';
import FileImport, { FileImportRef } from '../components/FileImport';
import { useTranslation } from '../shared/i18n/I18nProvider';

const Bot: React.FC = () => {
  const { t } = useTranslation();
  const isDragging = useRef(false);
  const startPos = useRef({ x: 0, y: 0 });
  // const [debugMessage, setDebugMessage] = useState<string>('');
  const [processing, setProcessing] = useState<boolean>(false);
  const importRef = useRef<FileImportRef>(null);
  const [menuVisible, setMenuVisible] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });

  // Work directory handling moved into FileImport component.

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
    if (key === 'importFile') {
      try {
        await importRef.current?.startImport();
      } catch (error) {
        console.error('Failed to import file via menu:', error);
        message.error(t('files.messages.fileImportFailed'));
      }
    } else if (key === 'showMain') {
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
    } else if (key === 'openWorkdir') {
      try {
  const cfg = (await window.electronAPI.getAppConfig()) as import('../shared/types').AppConfig;
        const workDir = cfg?.workDirectory as string | undefined;
        if (!workDir) {
          message.error('工作目录未设置');
          return;
        }
        if (window.electronAPI?.openFolder) {
          const ok = await window.electronAPI.openFolder(workDir);
          if (!ok) {
            message.error('打开工作目录失败');
          }
        } else {
          message.error('当前环境不支持打开目录');
        }
      } catch (error) {
        console.error('Failed to open work directory:', error);
        message.error('打开工作目录失败');
      }
    } else if (key === 'exitApp') {
      try {
        await window.electronAPI.quitApp();
      } catch (error) {
        console.error('Failed to quit application:', error);
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

  // Use FileImport to process files
  const handleFileImport = async (filePath: string) => {
    try {
      setProcessing(true);
      await importRef.current?.importFile(filePath);
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
      {/* FileImport renders its own modals; hidden trigger via ref */}
      <FileImport ref={importRef} onImported={() => { /* optional: toast/refresh */ }} />

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
            <Menu.Item key="importFile">导入文件</Menu.Item>
            <Menu.Item key="openWorkdir">打开工作目录</Menu.Item>
            <Menu.Item key="showMain">显示主窗口</Menu.Item>
            <Menu.Item key="hideBot">隐藏机器人</Menu.Item>
            <Menu.Divider />
            <Menu.Item danger key="exitApp">退出程序</Menu.Item>
          </Menu>
        </div>
      )}
    </div>
  );
};

export default Bot;