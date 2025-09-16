import React from 'react';
import reactLogo from '../assets/react.svg';

const Bot: React.FC = () => {
  const handleDoubleClick = async () => {
    try {
      await window.electronAPI.showMainWindow();
    } catch (error) {
      console.error('Failed to show main window:', error);
    }
  };

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