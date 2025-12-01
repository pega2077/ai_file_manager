import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout, Typography, Space, Button, message } from 'antd';
import reactLogo from '../assets/react.svg';
import { useTranslation } from '../shared/i18n/I18nProvider';

const { Content } = Layout;
const { Title, Text } = Typography;

const Landing = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const version = '0.0.1'; // Version from package.json

  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
  const cfg = (await window.electronAPI.getAppConfig()) as import('../shared/types').AppConfig;
        const isInitialized = Boolean(cfg?.isInitialized);
        console.log('isInitialized:', isInitialized);
        if (isInitialized) {
          navigate('/files');
        } else {
          // Always start with LLM setup for uninitialized apps
          navigate('/llm-setup');
        }
      } catch (error) {
        console.error('Error checking initialization status:', error);
        navigate('/llm-setup');
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
          <Title level={1}>{t('landing.title')}</Title>
          <Text type="secondary" style={{ fontSize: '16px' }}>
            {t('landing.version', { version })}
          </Text>
          <Text style={{ fontSize: '18px', maxWidth: '600px', margin: '0 auto', display: 'block' }}>
            {t('landing.description')}
          </Text>
          <Button
            type="default"
            onClick={async () => {
              await window.electronAPI.updateAppConfig({ isInitialized: false });
              message.success(t('landing.resetMessage'));
            }}
          >
            {t('landing.resetButton')}
          </Button>
        </Space>
      </Content>
    </Layout>
  );
};

export default Landing;