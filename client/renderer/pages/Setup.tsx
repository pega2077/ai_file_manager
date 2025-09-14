import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout, Steps, Form, Input, Button, Card, List, Space, message, Select } from 'antd';
import { apiService } from '../services/api';

const { Content } = Layout;
const { Step } = Steps;
const { TextArea } = Input;

interface DirectoryStructure {
  path: string;
  description: string;
}

declare global {
  interface Window {
    electronAPI: {
      selectFolder: () => Promise<string | null>;
    };
    electronStore: {
      get: (key: string) => Promise<unknown>;
      set: (key: string, value: unknown) => Promise<void>;
      delete: (key: string) => Promise<void>;
      has: (key: string) => Promise<boolean>;
    };
  }
}

const Setup = () => {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(0);
  const [form] = Form.useForm();
  const [directoryStructure, setDirectoryStructure] = useState<DirectoryStructure[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const steps = [
    {
      title: '配置信息',
      description: '填写职业和用途',
    },
    {
      title: '创建目录',
      description: '选择文件夹并创建目录结构',
    },
  ];

  const handleGetDirectoryStructure = async () => {
    try {
      setLoading(true);
      const values = await form.validateFields();
      const response = await apiService.getDirectoryStructure(values.profession, values.purpose);

      if (response.success) {
        setDirectoryStructure((response.data as { directories: DirectoryStructure[] }).directories);
        message.success('目录结构推荐生成成功');
      } else {
        message.error(response.message || '获取目录结构失败');
      }
    } catch (error) {
      message.error('获取目录结构失败');
    } finally {
      setLoading(false);
    }
  };

  const handleRegenerate = () => {
    handleGetDirectoryStructure();
  };

  const handleContinue = () => {
    setCurrentStep(1);
  };

  const handleSelectFolder = async () => {
    try {
      const folder = await window.electronAPI.selectFolder();
      if (folder) {
        setSelectedFolder(folder);
      }
    } catch (error) {
      message.error('选择文件夹失败');
    }
  };

  const handleCreateFolders = async () => {
    if (!selectedFolder) {
      message.error('请先选择目标文件夹');
      return;
    }

    try {
      setLoading(true);
      const structure = directoryStructure.map(dir => ({
        name: dir.path,
        type: 'folder',
      }));

      const response = await apiService.createFolders(selectedFolder, structure);

      if (response.success) {
        // 更新初始化状态和保存工作目录
        if (window.electronStore) {
          await window.electronStore.set('isInitialized', true);
          await window.electronStore.set('workDirectory', selectedFolder);
        }
        message.success('目录结构创建成功，初始化完成');
        navigate('/home');
      } else {
        message.error(response.message || '创建目录结构失败');
      }
    } catch (error) {
      message.error('创建目录结构失败');
    } finally {
      setLoading(false);
    }
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 0:
        return (
          <Card title="步骤一：配置信息" style={{ maxWidth: 600, margin: '0 auto' }}>
            <Form form={form} layout="vertical">
              <Form.Item
                name="profession"
                label="职业"
                rules={[{ required: true, message: '请输入职业' }]}
              >
                <Select placeholder="选择或输入职业">
                  <Select.Option value="软件工程师">软件工程师</Select.Option>
                  <Select.Option value="设计师">设计师</Select.Option>
                  <Select.Option value="教师">教师</Select.Option>
                  <Select.Option value="学生">学生</Select.Option>
                  <Select.Option value="项目经理">项目经理</Select.Option>
                  <Select.Option value="其他">其他</Select.Option>
                </Select>
              </Form.Item>

              <Form.Item
                name="purpose"
                label="用途"
                rules={[{ required: true, message: '请输入用途' }]}
              >
                <TextArea
                  placeholder="例如：项目管理、个人资料、学习资料等"
                  rows={3}
                />
              </Form.Item>

              <Space>
                <Button
                  type="primary"
                  onClick={handleGetDirectoryStructure}
                  loading={loading}
                >
                  获取推荐目录结构
                </Button>
              </Space>
            </Form>

            {directoryStructure.length > 0 && (
              <Card title="推荐目录结构" style={{ marginTop: 24 }}>
                <List
                  dataSource={directoryStructure}
                  renderItem={(item) => (
                    <List.Item>
                      <List.Item.Meta
                        title={item.path}
                        description={item.description}
                      />
                    </List.Item>
                  )}
                />
                <Space style={{ marginTop: 16 }}>
                  <Button onClick={handleRegenerate} loading={loading}>
                    重新生成
                  </Button>
                  <Button type="primary" onClick={handleContinue}>
                    继续
                  </Button>
                </Space>
              </Card>
            )}
          </Card>
        );

      case 1:
        return (
          <Card title="步骤二：创建目录" style={{ maxWidth: 600, margin: '0 auto' }}>
            <Space direction="vertical" style={{ width: '100%' }}>
              <div>
                <Button onClick={handleSelectFolder}>
                  选择目标文件夹
                </Button>
                {selectedFolder && (
                  <div style={{ marginTop: 8 }}>
                    <strong>已选择：</strong>{selectedFolder}
                  </div>
                )}
              </div>
              <Button
                type="primary"
                onClick={handleCreateFolders}
                loading={loading}
                disabled={!selectedFolder}
                block
              >
                创建目录结构并完成初始化
              </Button>  
              <Card title="将要创建的目录结构" size="small">
                <List
                  size="small"
                  dataSource={directoryStructure}
                  renderItem={(item) => (
                    <List.Item>
                      <List.Item.Meta
                        title={item.path}
                        description={item.description}
                      />
                    </List.Item>
                  )}
                />
              </Card>
            </Space>
          </Card>
        );

      default:
        return null;
    }
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Content style={{ padding: '24px', background: '#fff' }}>
        <div style={{ maxWidth: 800, margin: '0 auto' }}>
          <Steps current={currentStep} style={{ marginBottom: 24 }}>
            {steps.map((step, index) => (
              <Step key={index} title={step.title} description={step.description} />
            ))}
          </Steps>

          {renderStepContent()}
        </div>
      </Content>
    </Layout>
  );
};

export default Setup;