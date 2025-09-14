import { Layout, Card, Typography, Switch, Input, Button, message } from 'antd';
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const { Content } = Layout;
const { Title, Text } = Typography;
const { TextArea } = Input;

const Settings = () => {
  const navigate = useNavigate();
  const [settings, setSettings] = useState({
    theme: 'light',
    language: 'zh-CN',
    autoSave: true,
    showHiddenFiles: false,
    workDirectory: '',
  });

  useEffect(() => {
    // 从store加载设置
    const loadSettings = async () => {
      if (window.electronStore) {
        try {
          const workDirectory = await window.electronStore.get('workDirectory') as string;
          setSettings(prev => ({
            ...prev,
            workDirectory: workDirectory || '',
          }));
        } catch (error) {
          console.error('Failed to load settings:', error);
        }
      }
    };

    loadSettings();
  }, []);

  const handleSettingChange = (key: string, value: string | boolean) => {
    setSettings(prev => ({
      ...prev,
      [key]: value,
    }));
  };

  const handleSaveSettings = async () => {
    try {
      if (window.electronStore) {
        await window.electronStore.set('settings', settings);
        message.success('设置已保存');
      }
    } catch (error) {
      message.error('保存设置失败');
      console.error(error);
    }
  };

  const handleResetSettings = () => {
    setSettings({
      theme: 'light',
      language: 'zh-CN',
      autoSave: true,
      showHiddenFiles: false,
      workDirectory: '',
    });
    message.success('设置已重置');
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Content style={{ padding: '24px', background: '#fff' }}>
        <div style={{ maxWidth: 800, margin: '0 auto' }}>
          <Title level={2}>设置</Title>

          <Card title="基本设置" style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <Text strong>主题模式：</Text>
                <Switch
                  checkedChildren="深色"
                  unCheckedChildren="浅色"
                  checked={settings.theme === 'dark'}
                  onChange={(checked) => handleSettingChange('theme', checked ? 'dark' : 'light')}
                  style={{ marginLeft: 16 }}
                />
              </div>

              <div>
                <Text strong>语言：</Text>
                <Switch
                  checkedChildren="English"
                  unCheckedChildren="中文"
                  checked={settings.language === 'en-US'}
                  onChange={(checked) => handleSettingChange('language', checked ? 'en-US' : 'zh-CN')}
                  style={{ marginLeft: 16 }}
                />
              </div>

              <div>
                <Text strong>自动保存：</Text>
                <Switch
                  checked={settings.autoSave}
                  onChange={(checked) => handleSettingChange('autoSave', checked)}
                  style={{ marginLeft: 16 }}
                />
              </div>

              <div>
                <Text strong>显示隐藏文件：</Text>
                <Switch
                  checked={settings.showHiddenFiles}
                  onChange={(checked) => handleSettingChange('showHiddenFiles', checked)}
                  style={{ marginLeft: 16 }}
                />
              </div>
            </div>
          </Card>

          <Card title="工作目录" style={{ marginBottom: 24 }}>
            <div>
              <Text strong>当前工作目录：</Text>
              <TextArea
                value={settings.workDirectory}
                readOnly
                rows={2}
                style={{ marginTop: 8 }}
              />
              <Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
                工作目录在初始化时设置，如需修改请重新运行初始化流程。
              </Text>
            </div>
          </Card>

          <Card title="操作">
            <div style={{ display: 'flex', gap: '16px' }}>
              <Button type="primary" onClick={handleSaveSettings}>
                保存设置
              </Button>
              <Button onClick={handleResetSettings}>
                重置为默认
              </Button>
              <Button onClick={() => navigate('/home')}>
                返回主页
              </Button>
            </div>
          </Card>
        </div>
      </Content>
    </Layout>
  );
};

export default Settings;