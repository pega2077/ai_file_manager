import React, { useRef, useEffect, useState } from 'react';
import botLoadingImage from '../assets/mona-loading-default.gif';
import botStaticImage from '../assets/mona-loading-default-static.png';
import { message, Menu, Button, Tooltip } from 'antd';
import { UploadOutlined, SearchOutlined } from '@ant-design/icons';
import FileImport, { FileImportRef } from '../components/FileImport';
import { useTranslation } from '../shared/i18n/I18nProvider';

const Bot: React.FC = () => {
  const { t } = useTranslation();
  const isDragging = useRef(false);
  const startPos = useRef({ x: 0, y: 0 });
  const [processing, setProcessing] = useState<boolean>(false);
  const importRef = useRef<FileImportRef>(null);
  const [menuVisible, setMenuVisible] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
  const [isHovered, setIsHovered] = useState(false);

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
          message.error(t('bot.messages.workdirNotSet'));
          return;
        }
        if (window.electronAPI?.openFolder) {
          const ok = await window.electronAPI.openFolder(workDir);
          if (!ok) {
            message.error(t('bot.messages.openWorkdirFailed'));
          }
        } else {
          message.error(t('bot.messages.openFolderNotSupported'));
        }
      } catch (error) {
        console.error('Failed to open work directory:', error);
        message.error(t('bot.messages.openWorkdirFailed'));
      }
    } else if (key === 'exitApp') {
      try {
        await window.electronAPI.quitApp();
      } catch (error) {
        console.error('Failed to quit application:', error);
      }
    }
  };

  const handleImportClick = async () => {
    setMenuVisible(false);
    try {
      await importRef.current?.startImport();
    } catch (error) {
      console.error('Failed to import file via button:', error);
      message.error(t('files.messages.fileImportFailed'));
    }
  };

  const handleSearchClick = async () => {
    setMenuVisible(false);
    try {
      // Open the main window where the user can search. If you have a dedicated search API, replace this.
      await window.electronAPI.showMainWindow();
    } catch (error) {
      console.error('Failed to open main window for search:', error);
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    // Prevent default to avoid image selection/focus ring while enabling custom dragging
    e.preventDefault();
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
        const toastMessage = filePaths.length === 1
          ? t('bot.messages.droppedFilePath', { path: filePaths[0] })
          : t('bot.messages.filesDroppedCount', { count: filePaths.length });

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

  // Hide context menu when clicking outside
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
      position: 'relative',
      // Avoid any selection highlight on the whole surface
      userSelect: 'none' as const,
    }}>
      <div style={{
        display: 'flex',
        gap: 12,
        marginBottom: 12,
        alignItems: 'center',
      }}>
        <Tooltip title={t('bot.menu.importFile')}>
          <Button
            type="default"
            icon={<UploadOutlined />}
            onClick={handleImportClick}
            aria-label={t('bot.menu.importFile')}
          />
        </Tooltip>

        <Tooltip title={t('bot.menu.search') }>
          <Button
            type="default"
            icon={<SearchOutlined />}
            onClick={handleSearchClick}
            aria-label={t('bot.menu.search')}
          />
        </Tooltip>
      </div>
      <img
        id="bot-image"
        src={processing ? botLoadingImage : botStaticImage}
        alt={t('bot.menu.botImageAlt')}
        onDoubleClick={handleDoubleClick}
        onMouseDown={handleMouseDown}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onContextMenu={handleContextMenu}
        onDragStart={(e) => e.preventDefault()}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        draggable={false}
        style={{
          width: '200px',
          height: '200px',
          cursor: 'pointer',
          // Ensure the image never shows selection highlight or drag ghost
          userSelect: 'none',
          WebkitUserSelect: 'none',
          // Note: avoid unsupported vendor props to satisfy typings
          outline: 'none',
          WebkitTapHighlightColor: 'transparent',
          ...(isHovered ? { filter: 'drop-shadow(0px 0px 5px #000000ff)' } : {}),
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
            <Menu.Item key="importFile">{t('bot.menu.importFile')}</Menu.Item>
            <Menu.Item key="openWorkdir">{t('bot.menu.openWorkdir')}</Menu.Item>
            <Menu.Item key="showMain">{t('bot.menu.showMain')}</Menu.Item>
            <Menu.Item key="hideBot">{t('bot.menu.hideBot')}</Menu.Item>
            <Menu.Divider />
            <Menu.Item danger key="exitApp">{t('bot.menu.exitApp')}</Menu.Item>
          </Menu>
        </div>
      )}
    </div>
  );
};

export default Bot;