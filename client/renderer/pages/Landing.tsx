import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout, Typography, Space, Button, message } from 'antd';
import reactLogo from '../assets/react.svg';

const { Content } = Layout;
const { Title, Text } = Typography;

const Landing = () => {
  const navigate = useNavigate();
  const version = '0.0.1'; // Version from package.json

  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        if (window.electronStore) {
          const isInitialized = await window.electronStore.get('isInitialized');
          console.log('isInitialized:', isInitialized);
          if (isInitialized === true) {
            navigate('/files');
          } else {
            navigate('/setup');
          }
        } else {
          // Fallback if electronStore is not available
          navigate('/setup');
        }
      } catch (error) {
        console.error('Error checking initialization status:', error);
        navigate('/setup');
      }
    }, 2000);

    return () => clearTimeout(timer);
  }, [navigate]);

  return (
    <Layout style={{ minHeight: '100vh', background: '#fff' }}>
      <Content style={{ padding: '50px', textAlign: 'center' }}>
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <div>
            <img src={reactLogo} alt="Logo" style={{ width: '100px', height: '100px' }} />
          </div>
          <Title level={1}>AI File Manager</Title>
          <Text type="secondary" style={{ fontSize: '16px' }}>
            Version {version}
          </Text>
          <Text style={{ fontSize: '18px', maxWidth: '600px', margin: '0 auto', display: 'block' }}>
            An intelligent file management system powered by AI. Organize, search, and manage your files with advanced features.
          </Text>
          <Button
            type="default"
            onClick={async () => {
              if (window.electronStore) {
                await window.electronStore.set('isInitialized', false);
                message.success('初始化状态已重置');
              }
            }}
          >
            Reset Initialization (Test)
          </Button>
        </Space>
      </Content>
    </Layout>
  );
};

export default Landing;