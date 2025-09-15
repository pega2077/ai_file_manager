import React from 'react';
import { Layout } from 'antd';
import Sidebar from '../components/Sidebar';
import FileList from '../components/FileList';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';

const { Content } = Layout;

const FilesPage: React.FC = () => {
  const navigate = useNavigate();
  const [selectedMenu, setSelectedMenu] = useState('file-list');

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
          <div style={{ marginBottom: 16 }}>
            <h1>文件管理</h1>
            <p>查看和管理已导入到系统的文件</p>
          </div>

          <FileList />
        </Content>
      </Layout>
    </Layout>
  );
};

export default FilesPage;