import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout, Steps, Form, Input, Button, Card, Space, message, AutoComplete, Tree, Collapse } from 'antd';
import { apiService } from '../services/api';

const { Content } = Layout;
const { Step } = Steps;
const { TextArea } = Input;

interface DirectoryStructure {
  path: string;
  description: string;
}

interface TreeNode {
  title: string;
  key: string;
  children: TreeNode[];
}

const Setup = () => {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(0);
  const [form] = Form.useForm();
  const [directoryStructure, setDirectoryStructure] = useState<DirectoryStructure[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const buildTree = (directories: DirectoryStructure[]): { treeData: TreeNode[], expandedKeys: string[] } => {
    const root: TreeNode[] = [];
    const map = new Map<string, TreeNode>();
    const expandedKeys: string[] = [];
    directories.forEach(dir => {
      const parts = dir.path.split('/');
      let currentPath = '';
      let parent: TreeNode[] = root;
      parts.forEach((part, index) => {
        currentPath += (currentPath ? '/' : '') + part;
        if (!map.has(currentPath)) {
          const isLeaf = index === parts.length - 1;
          const node: TreeNode = {
            title: isLeaf ? `${part} : ${dir.description}` : part,
            key: currentPath,
            children: []
          };
          map.set(currentPath, node);
          parent.push(node);
          expandedKeys.push(currentPath);
        }
        parent = map.get(currentPath)!.children;
      });
    });
    return { treeData: root, expandedKeys };
  };

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
      const response = await apiService.getDirectoryStructure({
        profession: values.profession,
        purpose: values.purpose,
        max_depth: values.max_depth || 2,
        min_directories: values.min_directories || 6,
        max_directories: values.max_directories || 20,
        temperature: values.temperature || 0.7
      });

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
                <AutoComplete
                  placeholder="选择或输入职业"
                  options={[
                    { value: '软件工程师', label: '软件工程师' },
                    { value: '设计师', label: '设计师' },
                    { value: '教师', label: '教师' },
                    { value: '学生', label: '学生' },
                    { value: '项目经理', label: '项目经理' },
                    { value: '新媒体', label: '新媒体' },
                  ]}
                />
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

              <Collapse ghost>
                <Collapse.Panel header="高级选项" key="advanced">
                  <Form.Item
                    name="max_depth"
                    label="目录层级"
                    initialValue={2}
                  >
                    <Input type="number" min={1} max={5} />
                  </Form.Item>
                  <Form.Item
                    name="min_directories"
                    label="最少目录数量"
                    initialValue={6}
                  >
                    <Input type="number" min={1} max={50} />
                  </Form.Item>
                  <Form.Item
                    name="max_directories"
                    label="最多目录数量"
                    initialValue={20}
                  >
                    <Input type="number" min={1} max={50} />
                  </Form.Item>
                  <Form.Item
                    name="temperature"
                    label="温度"
                    initialValue={0.7}
                  >
                    <Input type="number" step={0.1} min={0} max={2} />
                  </Form.Item>
                </Collapse.Panel>
              </Collapse>

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
                <Space style={{ marginTop: 2, marginBottom: 16 }}>
                  <Button onClick={handleRegenerate} loading={loading}>
                    重新生成
                  </Button>
                  <Button type="primary" onClick={handleContinue}>
                    继续
                  </Button>
                </Space>
                
                {(() => {
                  const { treeData, expandedKeys } = buildTree(directoryStructure);
                  return (
                    <Tree
                      treeData={treeData}
                      defaultExpandedKeys={expandedKeys}
                    />
                  );
                })()}
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
                {(() => {
                  const { treeData, expandedKeys } = buildTree(directoryStructure);
                  return (
                    <Tree
                      treeData={treeData}
                      defaultExpandedKeys={expandedKeys}
                    />
                  );
                })()}
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