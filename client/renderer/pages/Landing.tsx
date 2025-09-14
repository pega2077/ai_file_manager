import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout, Typography, Space, Button } from 'antd';

const { Content } = Layout;
const { Title, Text } = Typography;

declare global {
  interface Window {
    electronStore: {
      get: (key: string) => unknown;
      set: (key: string, value: unknown) => void;
      delete: (key: string) => void;
      has: (key: string) => boolean;
    };
  }
}

const Landing = () => {
  const navigate = useNavigate();
  const version = '0.0.1'; // Version from package.json

  useEffect(() => {
    const timer = setTimeout(() => {
      const isInitialized = window.electronStore.get('isInitialized');
      console.log('isInitialized:', isInitialized);
      if (isInitialized === true) {
        navigate('/home');
      } else {
        navigate('/setup');
      }
    }, 3000);

    return () => clearTimeout(timer);
  }, [navigate]);

  return (
    <Layout style={{ minHeight: '100vh', background: '#fff' }}>
      <Content style={{ padding: '50px', textAlign: 'center' }}>
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <div>
            <img src="/electron-vite.svg" alt="Logo" style={{ width: '100px', height: '100px' }} />
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
            onClick={() => window.electronStore.set('isInitialized', false)}
          >
            Reset Initialization (Test)
          </Button>
        </Space>
      </Content>
    </Layout>
  );
};

export default Landing;