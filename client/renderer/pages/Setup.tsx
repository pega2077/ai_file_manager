import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout, Steps, Form, Input, Button, Card, Space, message, AutoComplete, Tree, Collapse, Select, Typography, Modal } from 'antd';
import { apiService, type DirectoryListItem, type DirectoryListResponse } from '../services/api';
import { useTranslation } from '../shared/i18n/I18nProvider';
import { findDirectoryStructurePreset } from '../shared/directoryPresets';
import type { DirectoryStructureEntry } from '../shared/directoryPresets';
import type { AppConfig } from '../shared/types';

import { electronAPI } from "../shared/electronAPI";
const { Content } = Layout;
const { Step } = Steps;
const { TextArea } = Input;
const { Text } = Typography;

type DirectoryStructure = DirectoryStructureEntry;

interface TreeNode {
  title: string;
  key: string;
  children: TreeNode[];
}

type ProfessionKey = typeof professionOptionKeys[number];

interface ProfessionOption {
  value: string;
  label: string;
  key: ProfessionKey;
}

const professionOptionKeys = [
  'softwareEngineer',
  'designer',
  'contentCreator',
  'teacher',
  'student',
  'projectManager',
  'lawyer',
] as const;

type LlmProvider = NonNullable<AppConfig['llmProvider']>;

const Setup = () => {
  const navigate = useNavigate();
  const { t, setLocale, locale, availableLocales, localeLabels } = useTranslation();
  const [currentStep, setCurrentStep] = useState(0);
  const [form] = Form.useForm();
  const [directoryStructure, setDirectoryStructure] = useState<DirectoryStructure[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string>('');
  const [existingDirectoryItems, setExistingDirectoryItems] = useState<DirectoryListItem[]>([]);
  const [checkedDirectoryPath, setCheckedDirectoryPath] = useState<string | null>(null);
  const [checkingDirectory, setCheckingDirectory] = useState(false);
  const [loading, setLoading] = useState(false);
  const [dirStyle, setDirStyle] = useState<'flat' | 'hierarchical'>('flat');
  const [collapseActiveKeys, setCollapseActiveKeys] = useState<string[]>([]);
  const [llmProvider, setLlmProvider] = useState<LlmProvider>('ollama');

  useEffect(() => {
    let mounted = true;
    const loadConfig = async () => {
      try {
        const cfg = (await electronAPI.getAppConfig()) as AppConfig | undefined;
        if (!mounted || !cfg) {
          return;
        }
        const provider = (cfg.llmProvider ?? 'ollama') as LlmProvider;
        setLlmProvider(provider);
        apiService.setProvider(provider);
      } catch (error) {
        console.error('Failed to load app config for setup:', error);
      }
    };
    void loadConfig();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    apiService.setProvider(llmProvider);
  }, [llmProvider]);

  // Provide AutoComplete options that keep the profession key in metadata so we can
  // map selection back to a known profession and auto-fill the purpose field.
  const professionOptions = useMemo(
    () =>
      professionOptionKeys.map((optionKey) => {
        const label = t(`setup.options.profession.${optionKey}`);
        // value is the localized label shown to user, attach the profession key so
        // we can determine which profession was selected and look up its purpose.
        return { value: label, label, key: optionKey } as ProfessionOption;
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
      {
        title: t('setup.stepThreeTitle'),
        description: t('setup.stepThreeDescription'),
      },
    ],
    [t],
  );

  const buildTree = (directories: DirectoryStructure[]): { treeData: TreeNode[]; expandedKeys: string[] } => {
    const root: TreeNode[] = [];
    const map = new Map<string, TreeNode>();
    const expandedKeys: string[] = [];

    directories.forEach((dir) => {
      // Normalize and validate path, avoid calling split on undefined/null
      const rawPath = (dir && typeof dir.path !== 'undefined' && dir.path !== null) ? String(dir.path) : '';
      // Convert Windows backslashes to forward slashes, trim redundant slashes
      const normalizedPath = rawPath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
      if (!normalizedPath) {
        return; // skip invalid entries
      }
      const parts = normalizedPath.split('/').filter(Boolean);
      if (parts.length === 0) {
        return;
      }
      let currentPath = '';
      let parent: TreeNode[] = root;

      parts.forEach((part, index) => {
        currentPath += (currentPath ? '/' : '') + part;
        if (!map.has(currentPath)) {
          const isLeaf = index === parts.length - 1;
          const node: TreeNode = {
            title: isLeaf ? `${part} : ${dir?.description ?? ''}` : part,
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

  const fetchDirectoryStructure = async (skipPreset: boolean) => {
    try {
      setLoading(true);
      const values = await form.validateFields();
      if (!skipPreset) {
        const presetDirectories = findDirectoryStructurePreset({
          profession: values.profession,
          purpose: values.purpose,
          style: dirStyle,
          language: locale,
        });

        if (presetDirectories && presetDirectories.length > 0) {
          setDirectoryStructure(presetDirectories);
          setCollapseActiveKeys([]);
          message.success(t('setup.messages.fetchPresetSuccess'));
          return;
        }
      }
      const response = await apiService.getDirectoryStructure({
        profession: values.profession,
        purpose: values.purpose,
        max_depth: values.max_depth || 2,
        min_directories: values.min_directories || 6,
        max_directories: values.max_directories || 20,
        temperature: values.temperature || 0.7,
        // pass UI language to backend prompt selector
        language: locale,
        style: dirStyle,
      });

      if (response.success) {
  setDirectoryStructure((response.data as { directories: DirectoryStructure[] }).directories);
        // auto-collapse advanced options after successful fetch
        setCollapseActiveKeys([]);
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

  const handleGetDirectoryStructure = () => {
    void fetchDirectoryStructure(false);
  };

  const handleRegenerate = () => {
    void fetchDirectoryStructure(true);
  };

  const logElectronError = async (title: string, details: Record<string, unknown>) => {
    if (typeof electronAPI.logError !== 'function') {
      return;
    }

    try {
      await electronAPI.logError(title, details);
    } catch {
      // Intentionally ignore logging failures to avoid blocking user flow
    }
  };

  const completeInitialization = async (workDirectory: string, successMessage: string): Promise<void> => {
    try {
      await electronAPI.updateAppConfig({ isInitialized: true, workDirectory });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      message.error(t('setup.messages.finalizeError'));
      await logElectronError('Failed to finalize setup configuration', {
        error: errorMessage,
        workDirectory,
      });
      throw new Error('SETUP_FINALIZE_FAILED');
    }

    if (typeof electronAPI.showBotWindow === 'function') {
      try {
        await electronAPI.showBotWindow();
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        await logElectronError('Failed to show assistant window after setup', {
          error: errorMessage,
        });
      }
    }

    message.success(successMessage);
    navigate('/files');
  };

  const inspectDirectory = async (folderPath: string) => {
    setCheckingDirectory(true);
    try {
      const response = await apiService.listDirectory(folderPath);
      if (!response.success) {
        message.error(t('setup.messages.listDirectoryError'));
        return;
      }

      const payload = (response.data ?? undefined) as DirectoryListResponse | undefined;
      const items = Array.isArray(payload?.items) ? payload.items : [];

      setExistingDirectoryItems(items);
      setCheckedDirectoryPath(payload?.directory_path ?? folderPath);

      if (items.length === 0) {
        message.success(t('setup.messages.emptyDirectoryReady'));
        return;
      }

      Modal.confirm({
        title: t('setup.dialogs.existingStructureTitle'),
        content: t('setup.dialogs.existingStructureContent', {
          path: payload?.directory_path ?? folderPath,
          count: items.length,
        }),
        okText: t('setup.dialogs.skipCreation'),
        cancelText: t('setup.dialogs.continueCreation'),
        centered: true,
        onOk: () => completeInitialization(folderPath, t('setup.messages.skipCreateSuccess')),
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      message.error(t('setup.messages.listDirectoryError'));
      await logElectronError('Failed to inspect directory contents during setup', {
        error: errorMessage,
        directory: folderPath,
      });
    } finally {
      setCheckingDirectory(false);
    }
  };

  const providerOptions = useMemo(
    () => [
      { value: 'ollama', label: t('setup.options.llmProviders.ollama') },
      { value: 'pega', label: t('setup.options.llmProviders.pega') },
      { value: 'openai', label: t('setup.options.llmProviders.openai') },
      { value: 'openrouter', label: t('setup.options.llmProviders.openrouter') },
      { value: 'bailian', label: t('setup.options.llmProviders.bailian') },
      { value: 'azure-openai', label: t('setup.options.llmProviders.azureOpenai') },
      { value: 'llamacpp', label: t('setup.options.llmProviders.llamacpp') },
    ],
    [t],
  );

  const directoryHasExistingItems = useMemo(() => {
    if (!selectedFolder || checkedDirectoryPath !== selectedFolder) {
      return false;
    }
    return existingDirectoryItems.length > 0;
  }, [selectedFolder, checkedDirectoryPath, existingDirectoryItems]);

  const directoryCheckedAndEmpty = useMemo(() => {
    if (!selectedFolder || checkedDirectoryPath !== selectedFolder) {
      return false;
    }
    return existingDirectoryItems.length === 0;
  }, [selectedFolder, checkedDirectoryPath, existingDirectoryItems]);

  const handleProviderChange = async (value: LlmProvider) => {
    setLlmProvider(value);
    apiService.setProvider(value);
    try {
      await electronAPI.updateAppConfig({ llmProvider: value });
      message.success(t('setup.messages.providerUpdated'));
    } catch (error) {
      message.error(t('setup.messages.providerUpdateError'));
      console.error('Failed to update provider:', error);
    }
  };

  const handleContinueToProfile = () => {
    if (checkingDirectory) {
      return;
    }
    setCurrentStep(1);
  };

  const handleContinueToCreate = () => {
    setCurrentStep(2);
  };

  const handleSelectFolder = async () => {
    try {
      const folder = await electronAPI.selectFolder();
      if (folder) {
        setSelectedFolder(folder);
        setExistingDirectoryItems([]);
        setCheckedDirectoryPath(null);
        await inspectDirectory(folder);
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
        await completeInitialization(selectedFolder, t('setup.messages.createSuccess'));
      } else {
        message.error(t('setup.messages.createError'));
      }
    } catch (error) {
      if (!(error instanceof Error && error.message === 'SETUP_FINALIZE_FAILED')) {
        message.error(t('setup.messages.createError'));
      }
    } finally {
      setLoading(false);
    }
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 0:
        return (
          <Card title={t('setup.cards.stepOne')} style={{ maxWidth: 600, margin: '0 auto' }}>
            <Space direction="vertical" style={{ width: '100%' }}>
              <div>
                <Button onClick={handleSelectFolder} loading={checkingDirectory}>
                  {t('setup.actions.selectTarget')}
                </Button>
                {selectedFolder && (
                  <div style={{ marginTop: 8 }}>
                    {t('setup.actions.selectedPath', { path: selectedFolder })}
                  </div>
                )}
                <div style={{ marginTop: 12 }}>
                  <Text type="secondary" style={{ display: 'block' }}>
                    {t('setup.hints.emptyDirectory')}
                  </Text>
                  <Text type="secondary" style={{ display: 'block', marginTop: 4 }}>
                    {t('setup.hints.existingDirectory')}
                  </Text>
                  {directoryHasExistingItems && (
                    <Text type="warning" style={{ display: 'block', marginTop: 8 }}>
                      {t('setup.messages.directoryHasItems', { count: existingDirectoryItems.length })}
                    </Text>
                  )}
                  {directoryCheckedAndEmpty && (
                    <Text type="success" style={{ display: 'block', marginTop: 8 }}>
                      {t('setup.messages.directoryIsEmpty')}
                    </Text>
                  )}
                </div>
              </div>
              {/* <div>
                <Text strong>{t('setup.form.llmProviderLabel')}</Text>
                <Select
                  style={{ width: '100%', marginTop: 8 }}
                  value={llmProvider}
                  options={providerOptions}
                  onChange={(value) => handleProviderChange(value as LlmProvider)}
                />
                <Text type="secondary" style={{ display: 'block', marginTop: 4 }}>
                  {t('setup.descriptions.llmProvider')}
                </Text>
              </div> */}
              <Button
                type="primary"
                onClick={handleContinueToProfile}
                disabled={!selectedFolder || checkingDirectory}
                block
              >
                {t('setup.actions.continue')}
              </Button>
            </Space>
          </Card>
        );

      case 1:
        return (
          <Card title={t('setup.cards.stepTwo')} style={{ maxWidth: 600, margin: '0 auto' }}>
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
                  onSelect={(_value, option) => {
                    // When user selects a known profession option, auto-fill purpose
                    // by mapping the profession key to the localized purpose text
                    const selectedKey = (option as ProfessionOption | undefined)?.key;
                    if (selectedKey) {
                      const purpose = t(`setup.options.professionPurposes.${selectedKey}`);
                      form.setFieldsValue({ purpose });
                    }
                  }}
                  onChange={(value) => {
                    // If user types a profession that exactly matches a localized option,
                    // fill purpose as well. Otherwise clear purpose to let user enter custom.
                    const matching = professionOptions.find((opt) => opt.value === value) as ProfessionOption | undefined;
                    if (matching?.key) {
                      const purpose = t(`setup.options.professionPurposes.${matching.key}`);
                      form.setFieldsValue({ purpose });
                    }
                  }}
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
                activeKey={collapseActiveKeys}
                onChange={(keys) =>
                  setCollapseActiveKeys(Array.isArray(keys) ? (keys as string[]) : [String(keys)])
                }
                items={[
                  {
                    key: 'advanced',
                    label: t('setup.optionalSettings'),
                    children: (
                      <>
                        <Form.Item label={t('setup.form.directoryStyle')}>
                          <Select value={dirStyle} onChange={setDirStyle} style={{ width: '100%' }}>
                            <Select.Option value="flat">{t('setup.options.style.flat')}</Select.Option>
                            <Select.Option value="hierarchical">{t('setup.options.style.hierarchical')}</Select.Option>
                          </Select>
                        </Form.Item>
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
                  <Button type="primary" onClick={handleContinueToCreate}>
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

      case 2:
        return (
          <Card title={t('setup.cards.stepThree')} style={{ maxWidth: 600, margin: '0 auto' }}>
            <Space direction="vertical" style={{ width: '100%' }}>
              <div>
                <strong>{t('setup.actions.selectedPath', { path: selectedFolder })}</strong>
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
          <Select
            value={locale}
            onChange={setLocale}
            style={{ width: 120, marginBottom: 16 }}
          >
            {availableLocales.map((lang) => (
              <Select.Option key={lang} value={lang}>
                {localeLabels[lang]}
              </Select.Option>
            ))}
          </Select>
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
