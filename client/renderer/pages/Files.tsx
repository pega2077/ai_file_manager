import React from 'react';
import { Layout, Button, message } from 'antd';
import { DatabaseOutlined } from '@ant-design/icons';
import Sidebar from '../components/Sidebar';
import FileList from '../components/FileList';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { apiService } from '../services/api';

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

  const handleImportToRag = async () => {
    try {
      const loadingKey = message.loading('正在获取文件列表...', 0);
      
      // 获取所有文件
      const response = await apiService.getFileList({ page: 1, limit: 1000 });
      loadingKey();
      
      if (!response.success) {
        message.error('获取文件列表失败');
        return;
      }

      const data = response.data as { files: Array<{ id: string; name: string; path: string }> };
      const files = data.files;
      if (files.length === 0) {
        message.warning('没有找到可导入的文件');
        return;
      }

      const importLoadingKey = message.loading(`正在导入 ${files.length} 个文件到知识库...`, 0);
      
      let successCount = 0;
      let failCount = 0;

      for (const file of files) {
        try {
          const ragResponse = await apiService.importToRag(file.path);
          if (ragResponse.success) {
            successCount++;
          } else {
            failCount++;
          }
        } catch (error) {
          failCount++;
          console.error(`导入文件 ${file.name} 失败:`, error);
        }
      }

      importLoadingKey();
      
      if (successCount > 0) {
        message.success(`成功导入 ${successCount} 个文件到知识库${failCount > 0 ? `，${failCount} 个文件导入失败` : ''}`);
      } else {
        message.error('导入知识库失败');
      }
    } catch (error) {
      message.error('导入知识库失败');
      console.error(error);
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
            {/* <Button
              type="primary"
              icon={<DatabaseOutlined />}
              onClick={handleImportToRag}
              size="large"
            >
              导入知识库
            </Button> */}
          </div>

          <FileList />
        </Content>
      </Layout>
    </Layout>
  );
};

export default FilesPage;