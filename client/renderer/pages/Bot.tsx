import React, { useRef, useEffect, useState } from 'react';
import reactLogo from '../assets/react.svg';

const Bot: React.FC = () => {
  const isDragging = useRef(false);
  const startPos = useRef({ x: 0, y: 0 });
  const [toast, setToast] = useState<{ visible: boolean; message: string }>({ visible: false, message: '' });

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
        const message = files.length === 1
          ? `FilePath: ${filePaths[0]}`
          : `${files.length} files dropped`;

        setToast({ visible: true, message });

        // Hide toast after 3 seconds
        setTimeout(() => {
          setToast({ visible: false, message: '' });
        }, 3000);

        // TODO: Process the dropped files (e.g., send to import service)
      }
    } catch (error) {
      console.error('Error processing dropped files:', error);
      setToast({ visible: true, message: 'Error processing files' });
      setTimeout(() => {
        setToast({ visible: false, message: '' });
      }, 3000);
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
      {toast.visible && (
        <div style={{
          position: 'absolute',
          top: '20px',
          backgroundColor: 'rgba(128, 128, 128, 0.8)',
          color: 'white',
          padding: '10px 20px',
          borderRadius: '5px',
          border: '1px solid #ccc',
          fontSize: '14px',
          zIndex: 1000,
          maxWidth: '300px',
          textAlign: 'center'
        }}>
          {toast.message}
        </div>
      )}
      <img
        id="bot-image"
        src={reactLogo}
        alt="React Logo"
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
    </div>
  );
};

export default Bot;