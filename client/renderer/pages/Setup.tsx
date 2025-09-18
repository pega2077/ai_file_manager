import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout, Steps, Form, Input, Button, Card, Space, message, AutoComplete, Tree, Collapse } from 'antd';
import { apiService } from '../services/api';
import { useTranslation } from '../shared/i18n/I18nProvider';

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

const professionOptionKeys = [
  'softwareEngineer',
  'lawyer',
  'teacher',
  'student',
  'projectManager',
  'contentCreator',
] as const;

const Setup = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [currentStep, setCurrentStep] = useState(0);
  const [form] = Form.useForm();
  const [directoryStructure, setDirectoryStructure] = useState<DirectoryStructure[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const professionOptions = useMemo(
    () =>
      professionOptionKeys.map((optionKey) => {
        const label = t(`setup.options.profession.${optionKey}`);
        return { value: label, label };
      }),
    [t],
  );

  const steps = useMemo(
    () => [
      {
        title: t('setup.stepOneTitle'),
        description: t('setup.stepOneDescription'),
      },
      {
        title: t('setup.stepTwoTitle'),
        description: t('setup.stepTwoDescription'),
      },
    ],
    [t],
  );

  const buildTree = (directories: DirectoryStructure[]): { treeData: TreeNode[]; expandedKeys: string[] } => {
    const root: TreeNode[] = [];
    const map = new Map<string, TreeNode>();
    const expandedKeys: string[] = [];

    directories.forEach((dir) => {
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
            children: [],
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
        temperature: values.temperature || 0.7,
      });

      if (response.success) {
        setDirectoryStructure((response.data as { directories: DirectoryStructure[] }).directories);
        message.success(t('setup.messages.fetchSuccess'));
      } else {
        message.error(t('setup.messages.fetchError'));
      }
    } catch (error) {
      message.error(t('setup.messages.fetchError'));
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
      message.error(t('setup.messages.selectFolderError'));
    }
  };

  const handleCreateFolders = async () => {
    if (!selectedFolder) {
      message.error(t('setup.messages.missingTarget'));
      return;
    }

    try {
      setLoading(true);
      const structure = directoryStructure.map((dir) => ({
        name: dir.path,
        type: 'folder',
      }));

      const response = await apiService.createFolders(selectedFolder, structure);

      if (response.success) {
        if (window.electronStore) {
          await window.electronStore.set('isInitialized', true);
          await window.electronStore.set('workDirectory', selectedFolder);
        }

        message.success(t('setup.messages.createSuccess'));
        navigate('/home');
      } else {
        message.error(t('setup.messages.createError'));
      }
    } catch (error) {
      message.error(t('setup.messages.createError'));
    } finally {
      setLoading(false);
    }
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 0:
        return (
          <Card title={t('setup.cards.stepOne')} style={{ maxWidth: 600, margin: '0 auto' }}>
            <Form form={form} layout="vertical">
              <Form.Item
                name="profession"
                label={t('setup.form.professionLabel')}
                rules={[{ required: true, message: t('setup.validation.professionRequired') }]}
              >
                <AutoComplete
                  placeholder={t('setup.placeholders.profession')}
                  options={professionOptions}
                  filterOption={(inputValue, option) =>
                    option?.value.toLowerCase().includes(inputValue.toLowerCase()) ?? false
                  }
                />
              </Form.Item>

              <Form.Item
                name="purpose"
                label={t('setup.form.purposeLabel')}
                rules={[{ required: true, message: t('setup.validation.purposeRequired') }]}
              >
                <TextArea placeholder={t('setup.placeholders.purpose')} rows={3} />
              </Form.Item>

              <Collapse
                ghost
                items={[
                  {
                    key: 'advanced',
                    label: t('setup.optionalSettings'),
                    children: (
                      <>
                        <Form.Item
                          name="max_depth"
                          label={t('setup.form.maxDepth')}
                          initialValue={2}
                        >
                          <Input type="number" min={1} max={5} />
                        </Form.Item>
                        <Form.Item
                          name="min_directories"
                          label={t('setup.form.minDirectories')}
                          initialValue={6}
                        >
                          <Input type="number" min={1} max={50} />
                        </Form.Item>
                        <Form.Item
                          name="max_directories"
                          label={t('setup.form.maxDirectories')}
                          initialValue={20}
                        >
                          <Input type="number" min={1} max={50} />
                        </Form.Item>
                        <Form.Item
                          name="temperature"
                          label={t('setup.form.temperature')}
                          initialValue={0.7}
                        >
                          <Input type="number" step={0.1} min={0} max={2} />
                        </Form.Item>
                      </>
                    ),
                  },
                ]}
              />

              <Space>
                <Button
                  type="primary"
                  onClick={handleGetDirectoryStructure}
                  loading={loading}
                >
                  {t('setup.actions.fetchRecommendation')}
                </Button>
              </Space>
            </Form>

            {directoryStructure.length > 0 && (
              <Card title={t('setup.cards.recommendations')} style={{ marginTop: 24 }}>
                <Space style={{ marginTop: 2, marginBottom: 16 }}>
                  <Button onClick={handleRegenerate} loading={loading}>
                    {t('setup.actions.regenerate')}
                  </Button>
                  <Button type="primary" onClick={handleContinue}>
                    {t('setup.actions.continue')}
                  </Button>
                </Space>

                {(() => {
                  const { treeData, expandedKeys } = buildTree(directoryStructure);
                  return (
                    <Tree treeData={treeData} defaultExpandedKeys={expandedKeys} />
                  );
                })()}
              </Card>
            )}
          </Card>
        );

      case 1:
        return (
          <Card title={t('setup.cards.stepTwo')} style={{ maxWidth: 600, margin: '0 auto' }}>
            <Space direction="vertical" style={{ width: '100%' }}>
              <div>
                <Button onClick={handleSelectFolder}>
                  {t('setup.actions.selectTarget')}
                </Button>
                {selectedFolder && (
                  <div style={{ marginTop: 8 }}>
                    {t('setup.actions.selectedPath', { path: selectedFolder })}
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
                {t('setup.actions.createStructure')}
              </Button>
              <Card title={t('setup.cards.pending')} size="small">
                {(() => {
                  const { treeData, expandedKeys } = buildTree(directoryStructure);
                  return (
                    <Tree treeData={treeData} defaultExpandedKeys={expandedKeys} />
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
