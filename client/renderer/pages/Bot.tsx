import React, { useRef, useEffect } from 'react';
import reactLogo from '../assets/react.svg';

const Bot: React.FC = () => {
  const isDragging = useRef(false);
  const startPos = useRef({ x: 0, y: 0 });

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
      justifyContent: 'center',
      alignItems: 'center',
      height: '100vh',
      width: '100vw'
    }}>
      <img
        src={reactLogo}
        alt="React Logo"
        onDoubleClick={handleDoubleClick}
        onMouseDown={handleMouseDown}
        onDragStart={(e) => e.preventDefault()}
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