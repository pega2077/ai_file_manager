import { Layout, Card, Typography, Switch, Input, Button, message, Modal } from 'antd';
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiService } from '../services/api';

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
    enablePreview: true, // 新增预览开关
    autoSaveRAG: true, // 新增自动保存RAG设置开关
    autoClassifyWithoutConfirmation: false, // 新增自动分类开关
    workDirectory: '',
  });

  useEffect(() => {
    // 从store加载设置
    const loadSettings = async () => {
      if (window.electronStore) {
        try {
          const savedSettings = await window.electronStore.get('settings') as Partial<typeof settings>;
          const workDirectory = await window.electronStore.get('workDirectory') as string;

          setSettings(prev => ({
            ...prev,
            ...savedSettings,
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
      enablePreview: true,
      autoSaveRAG: true,
      autoClassifyWithoutConfirmation: false,
      workDirectory: '',
    });
    message.success('设置已重置');
  };

  const handleClearAllData = () => {
    Modal.confirm({
      title: '确认清空所有数据',
      content: '此操作将永久删除所有文件记录、向量数据和对话历史。此操作不可撤销，确定要继续吗？',
      okText: '确定清空',
      cancelText: '取消',
      okType: 'danger',
      onOk: async () => {
        try {
          const response = await apiService.clearAllData();
          if (response.success) {
            message.success('所有数据已清空');
          } else {
            message.error('清空数据失败：' + response.message);
          }
        } catch (error) {
          message.error('清空数据时发生错误');
          console.error('Clear data error:', error);
        }
      },
    });
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

              <div>
                <Text strong>启用文件预览：</Text>
                <Switch
                  checked={settings.enablePreview}
                  onChange={(checked) => handleSettingChange('enablePreview', checked)}
                  style={{ marginLeft: 16 }}
                />
                <Text type="secondary" style={{ marginLeft: 8 }}>
                  双击文件时显示预览而不是直接打开
                </Text>
              </div>

              <div>
                <Text strong>自动保存RAG设置：</Text>
                <Switch
                  checked={settings.autoSaveRAG}
                  onChange={(checked) => handleSettingChange('autoSaveRAG', checked)}
                  style={{ marginLeft: 16 }}
                />
                <Text type="secondary" style={{ marginLeft: 8 }}>
                  启用后，RAG相关设置将自动保存
                </Text>
              </div>

              <div>
                <Text strong>自动分类（无需确认）：</Text>
                <Switch
                  checked={settings.autoClassifyWithoutConfirmation}
                  onChange={(checked) => handleSettingChange('autoClassifyWithoutConfirmation', checked)}
                  style={{ marginLeft: 16 }}
                />
                <Text type="secondary" style={{ marginLeft: 8 }}>
                  启用后，文件将自动分类而不显示确认对话框
                </Text>
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
              <Button danger onClick={handleClearAllData}>
                清空所有数据
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