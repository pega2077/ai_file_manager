import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Layout,
  Steps,
  Card,
  Select,
  Form,
  Input,
  Button,
  Space,
  message,
  Typography,
  Spin,
  Alert,
  Tabs,
} from 'antd';
import type { TabsProps } from 'antd';
import { apiService } from '../services/api';
import { useTranslation } from '../shared/i18n/I18nProvider';
import type { AppConfig } from '../shared/types';
import { detectPegaIdentifier } from '../shared/utils/pegaAuth';

const { Content } = Layout;
const { Step } = Steps;
const { Title, Text, Paragraph } = Typography;

type LlmProvider = NonNullable<AppConfig['llmProvider']>;

interface ModelInfo {
  id: string;
  name: string;
}

interface ModelsResponse {
  models: ModelInfo[];
  chatModels: ModelInfo[];
  visionModels: ModelInfo[];
  embedModels: ModelInfo[];
}

interface ProviderConfigValues {
  endpoint?: string;
  apiKey?: string;
}

interface LoginFormValues {
  identifier: string;
  password: string;
}

interface RegisterFormValues {
  identifier: string;
  password: string;
  confirmPassword: string;
}

const TAB_LOGIN = 'login';
const TAB_REGISTER = 'register';

const LLMSetup = () => {
  const navigate = useNavigate();
  const { t, setLocale, locale, availableLocales, localeLabels } = useTranslation();
  const [currentStep, setCurrentStep] = useState(0);
  const [selectedProvider, setSelectedProvider] = useState<LlmProvider>('pega');
  const [configForm] = Form.useForm<ProviderConfigValues>();
  const [modelForm] = Form.useForm();
  const [loginForm] = Form.useForm<LoginFormValues>();
  const [registerForm] = Form.useForm<RegisterFormValues>();
  const [loading, setLoading] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [models, setModels] = useState<ModelsResponse | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>(TAB_LOGIN);
  const [pegaLoggedIn, setPegaLoggedIn] = useState(false);
  const [storedApiKey, setStoredApiKey] = useState('');

  const providerOptions = useMemo(
    () => [
      { value: 'pega', label: t('llmSetup.options.providers.pega') },
      { value: 'ollama', label: t('llmSetup.options.providers.ollama') },
      { value: 'openai', label: t('llmSetup.options.providers.openai') },
      { value: 'openrouter', label: t('llmSetup.options.providers.openrouter') },
      { value: 'bailian', label: t('llmSetup.options.providers.bailian') },
      { value: 'azure-openai', label: t('llmSetup.options.providers.azureOpenai') },
      { value: 'llamacpp', label: t('llmSetup.options.providers.llamacpp') },
    ],
    [t],
  );

  const steps = useMemo(
    () => [
      {
        title: t('llmSetup.steps.selectProvider.title'),
        description: t('llmSetup.steps.selectProvider.description'),
      },
      {
        title: t('llmSetup.steps.configure.title'),
        description: t('llmSetup.steps.configure.description'),
      },
      {
        title: t('llmSetup.steps.selectModels.title'),
        description: t('llmSetup.steps.selectModels.description'),
      },
    ],
    [t],
  );

  // Load existing config on mount
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const cfg = (await window.electronAPI.getAppConfig()) as AppConfig | undefined;
        if (cfg) {
          if (cfg.llmProvider) {
            setSelectedProvider(cfg.llmProvider);
          }
          // Check if Pega is already configured
          if (cfg.pega?.pegaApiKey || cfg.pega?.pegaAuthToken) {
            setPegaLoggedIn(true);
            setStoredApiKey(cfg.pega?.pegaApiKey || '');
            apiService.setPegaApiKey(cfg.pega?.pegaApiKey || null);
            apiService.setPegaAuthToken(cfg.pega?.pegaAuthToken || null);
          }
        }
      } catch (error) {
        console.error('Failed to load config:', error);
      }
    };
    void loadConfig();
  }, []);

  // Check if provider requires API key
  const providerNeedsApiKey = useMemo(() => {
    return ['openai', 'azure-openai', 'openrouter', 'bailian'].includes(selectedProvider);
  }, [selectedProvider]);

  // Check if provider uses Pega login
  const providerUsesPegaLogin = useMemo(() => {
    return selectedProvider === 'pega';
  }, [selectedProvider]);

  // Check if provider needs endpoint configuration
  const providerNeedsEndpoint = useMemo(() => {
    return ['ollama', 'llamacpp'].includes(selectedProvider);
  }, [selectedProvider]);

  // Get provider-specific defaults
  const getProviderDefaults = (provider: LlmProvider): { endpoint?: string } => {
    switch (provider) {
      case 'ollama':
        return { endpoint: 'http://127.0.0.1:11434' };
      case 'openai':
        return { endpoint: 'https://api.openai.com/v1' };
      case 'openrouter':
        return { endpoint: 'https://openrouter.ai/api/v1' };
      case 'bailian':
        return { endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1' };
      case 'llamacpp':
        return { endpoint: 'http://127.0.0.1:8080' };
      default:
        return {};
    }
  };

  const handleProviderSelect = (value: LlmProvider) => {
    setSelectedProvider(value);
    setModels(null);
    setModelsError(null);
    // Set default values for the config form
    const defaults = getProviderDefaults(value);
    configForm.setFieldsValue(defaults);
  };

  const handleContinueToConfig = () => {
    setCurrentStep(1);
    const defaults = getProviderDefaults(selectedProvider);
    configForm.setFieldsValue(defaults);
  };

  const handleSaveConfig = async (values: ProviderConfigValues) => {
    setLoading(true);
    try {
      let configUpdate: Partial<AppConfig> = {
        llmProvider: selectedProvider,
      };

      switch (selectedProvider) {
        case 'ollama':
          configUpdate.ollama = {
            ollamaEndpoint: values.endpoint,
            ollamaApiKey: values.apiKey,
          };
          break;
        case 'openai':
        case 'azure-openai':
          configUpdate.openai = {
            openaiEndpoint: values.endpoint || 'https://api.openai.com/v1',
            openaiApiKey: values.apiKey,
          };
          break;
        case 'openrouter':
          configUpdate.openrouter = {
            openrouterEndpoint: values.endpoint || 'https://openrouter.ai/api/v1',
            openrouterApiKey: values.apiKey,
          };
          break;
        case 'bailian':
          configUpdate.bailian = {
            bailianEndpoint: values.endpoint || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
            bailianApiKey: values.apiKey,
          };
          break;
        case 'llamacpp': {
          let host = '127.0.0.1';
          let port = 8080;
          if (values.endpoint) {
            try {
              const url = new URL(values.endpoint);
              host = url.hostname || '127.0.0.1';
              port = parseInt(url.port || '8080', 10) || 8080;
            } catch {
              // Use defaults if URL parsing fails
              console.warn('Failed to parse llamacpp endpoint URL, using defaults');
            }
          }
          configUpdate.llamacpp = {
            llamacppHost: host,
            llamacppPort: port,
          };
          break;
        }
      }

      await window.electronAPI.updateAppConfig(configUpdate);
      apiService.setProvider(selectedProvider);
      message.success(t('llmSetup.messages.configSaved'));
      setCurrentStep(2);
      // Automatically fetch models
      void fetchModels();
    } catch (error) {
      console.error('Failed to save config:', error);
      message.error(t('llmSetup.messages.configSaveFailed'));
    } finally {
      setLoading(false);
    }
  };

  const fetchModels = async () => {
    setModelsLoading(true);
    setModelsError(null);
    try {
      const apiBaseUrl = await window.electronAPI.getApiBaseUrl();
      const response = await fetch(`${apiBaseUrl}/api/providers/models`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ provider: selectedProvider }),
      });

      const result: unknown = await response.json();
      
      // Validate response structure
      const isValidResult = (obj: unknown): obj is { success: boolean; data?: ModelsResponse; error?: { message: string } } => {
        if (typeof obj !== 'object' || obj === null) return false;
        const r = obj as Record<string, unknown>;
        return typeof r.success === 'boolean';
      };
      
      if (!isValidResult(result)) {
        setModelsError(t('llmSetup.messages.fetchModelsFailed'));
        return;
      }

      if (result.success && result.data) {
        setModels(result.data);
        // Pre-fill with first available models - batch all updates
        const formValues: Record<string, string> = {};
        if (result.data.chatModels.length > 0) {
          formValues.chatModel = result.data.chatModels[0]?.id;
        }
        if (result.data.visionModels.length > 0) {
          formValues.visionModel = result.data.visionModels[0]?.id;
        }
        if (result.data.embedModels.length > 0) {
          formValues.embedModel = result.data.embedModels[0]?.id;
        }
        if (Object.keys(formValues).length > 0) {
          modelForm.setFieldsValue(formValues);
        }
      } else {
        setModelsError(result.error?.message || t('llmSetup.messages.fetchModelsFailed'));
      }
    } catch (error) {
      console.error('Failed to fetch models:', error);
      setModelsError(t('llmSetup.messages.fetchModelsFailed'));
    } finally {
      setModelsLoading(false);
    }
  };

  const handleSaveModels = async (values: { chatModel?: string; visionModel?: string; embedModel?: string }) => {
    setLoading(true);
    try {
      let configUpdate: Partial<AppConfig> = {};

      switch (selectedProvider) {
        case 'ollama':
          configUpdate.ollama = {
            ollamaModel: values.chatModel,
            ollamaVisionModel: values.visionModel,
            ollamaEmbedModel: values.embedModel,
          };
          break;
        case 'openai':
        case 'azure-openai':
          configUpdate.openai = {
            openaiModel: values.chatModel,
            openaiVisionModel: values.visionModel,
            openaiEmbedModel: values.embedModel,
          };
          break;
        case 'openrouter':
          configUpdate.openrouter = {
            openrouterModel: values.chatModel,
            openrouterVisionModel: values.visionModel,
            openrouterEmbedModel: values.embedModel,
          };
          break;
        case 'bailian':
          configUpdate.bailian = {
            bailianModel: values.chatModel,
            bailianVisionModel: values.visionModel,
            bailianEmbedModel: values.embedModel,
          };
          break;
        case 'pega':
          configUpdate.pega = {
            pegaModel: values.chatModel,
            pegaVisionModel: values.visionModel,
            pegaEmbedModel: values.embedModel,
          };
          break;
      }

      await window.electronAPI.updateAppConfig(configUpdate);
      message.success(t('llmSetup.messages.modelsSaved'));
      // Navigate to the next setup step (directory setup)
      navigate('/setup');
    } catch (error) {
      console.error('Failed to save models:', error);
      message.error(t('llmSetup.messages.modelsSaveFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleSkipModels = async () => {
    setLoading(true);
    try {
      // Just save the provider selection and continue
      await window.electronAPI.updateAppConfig({ llmProvider: selectedProvider });
      navigate('/setup');
    } catch (error) {
      console.error('Failed to save provider:', error);
      message.error(t('llmSetup.messages.saveFailed'));
    } finally {
      setLoading(false);
    }
  };

  // Pega login handling
  const handlePegaLogin = async (values: LoginFormValues) => {
    setLoading(true);
    try {
      const detection = detectPegaIdentifier(values.identifier);
      if (!detection) {
        message.error(t('pegaAuth.validation.identifierFormat'));
        return;
      }

      const loginResponse = await apiService.loginPegaAccount({
        identifier: detection.normalized,
        password: values.password,
      });
      const token = loginResponse.token;
      if (!token) {
        message.error(loginResponse.message || t('pegaAuth.messages.loginFailed'));
        return;
      }
      message.success(loginResponse.message || t('pegaAuth.messages.loginSuccess'));

      const apiKeyResponse = await apiService.fetchPegaApiKey(token);
      const apiKey = apiKeyResponse.apiKey;
      if (!apiKey) {
        message.error(apiKeyResponse.message || t('pegaAuth.messages.apiKeyFailed'));
        return;
      }

      const nextPegaConfig = {
        pegaApiKey: apiKey,
        pegaAuthToken: token,
      };
      await window.electronAPI.updateAppConfig({ llmProvider: 'pega', pega: nextPegaConfig });
      apiService.setProvider('pega');
      apiService.setPegaApiKey(apiKey);
      apiService.setPegaAuthToken(token);

      setStoredApiKey(apiKey);
      setPegaLoggedIn(true);
      message.success(apiKeyResponse.message || t('pegaAuth.messages.apiKeySuccess'));
      loginForm.resetFields();
      // Move to model selection
      setCurrentStep(2);
      void fetchModels();
    } catch (error) {
      console.error('Pega login failed:', error);
      message.error(t('pegaAuth.messages.loginFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handlePegaRegister = async (values: RegisterFormValues) => {
    setLoading(true);
    try {
      const detection = detectPegaIdentifier(values.identifier);
      if (!detection) {
        message.error(t('pegaAuth.validation.identifierFormat'));
        return;
      }

      const response = await apiService.registerPegaAccount({
        email: detection.type === 'email' ? detection.normalized : undefined,
        phone: detection.type === 'phone' ? detection.normalized : undefined,
        password: values.password,
      });
      message.success(response.message || t('pegaAuth.messages.registerSuccess'));
      loginForm.setFieldsValue({ identifier: detection.raw, password: values.password });
      setActiveTab(TAB_LOGIN);
    } catch (error) {
      console.error('Registration failed:', error);
      message.error(t('pegaAuth.messages.registerFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handlePegaSkip = async () => {
    // Continue without login (limited access)
    setLoading(true);
    try {
      await window.electronAPI.updateAppConfig({ llmProvider: 'pega' });
      apiService.setProvider('pega');
      setCurrentStep(2);
      void fetchModels();
    } catch (error) {
      console.error('Failed to save provider:', error);
      message.error(t('llmSetup.messages.saveFailed'));
    } finally {
      setLoading(false);
    }
  };

  const identifierFormRules = useMemo(
    () => [
      { required: true, message: t('pegaAuth.validation.identifierRequired') },
      () => ({
        validator(_: unknown, value: string) {
          if (!value) {
            return Promise.resolve();
          }
          return detectPegaIdentifier(value)
            ? Promise.resolve()
            : Promise.reject(new Error(t('pegaAuth.validation.identifierFormat')));
        },
      }),
    ],
    [t],
  );

  const renderStepContent = () => {
    switch (currentStep) {
      case 0:
        return (
          <Card title={t('llmSetup.cards.selectProvider')} style={{ maxWidth: 600, margin: '0 auto' }}>
            <Space direction="vertical" style={{ width: '100%' }} size="large">
              <div>
                <Text strong>{t('llmSetup.form.providerLabel')}</Text>
                <Select
                  style={{ width: '100%', marginTop: 8 }}
                  value={selectedProvider}
                  options={providerOptions}
                  onChange={handleProviderSelect}
                  size="large"
                />
                <Paragraph type="secondary" style={{ marginTop: 8 }}>
                  {t('llmSetup.descriptions.provider')}
                </Paragraph>
              </div>
              <Button type="primary" onClick={handleContinueToConfig} block size="large">
                {t('common.next')}
              </Button>
            </Space>
          </Card>
        );

      case 1:
        if (providerUsesPegaLogin) {
          const loginTab = (
            <Form layout="vertical" form={loginForm} onFinish={handlePegaLogin}>
              <Form.Item name="identifier" label={t('pegaAuth.form.identifier')} rules={identifierFormRules}>
                <Input placeholder={t('pegaAuth.placeholders.identifier')} autoComplete="username" allowClear />
              </Form.Item>
              <Form.Item
                name="password"
                label={t('pegaAuth.form.password')}
                rules={[{ required: true, message: t('pegaAuth.validation.passwordRequired') }]}
              >
                <Input.Password autoComplete="current-password" />
              </Form.Item>
              <Form.Item>
                <Button type="primary" htmlType="submit" loading={loading} block>
                  {t('pegaAuth.actions.login')}
                </Button>
              </Form.Item>
            </Form>
          );

          const registerTab = (
            <Form layout="vertical" form={registerForm} onFinish={handlePegaRegister}>
              <Form.Item name="identifier" label={t('pegaAuth.form.identifier')} rules={identifierFormRules}>
                <Input placeholder={t('pegaAuth.placeholders.identifier')} autoComplete="username" allowClear />
              </Form.Item>
              <Form.Item
                name="password"
                label={t('pegaAuth.form.password')}
                rules={[
                  { required: true, message: t('pegaAuth.validation.passwordRequired') },
                  { min: 6, message: t('pegaAuth.validation.passwordLength') },
                ]}
                hasFeedback
              >
                <Input.Password autoComplete="new-password" />
              </Form.Item>
              <Form.Item
                name="confirmPassword"
                label={t('pegaAuth.form.confirmPassword')}
                dependencies={['password']}
                hasFeedback
                rules={[
                  { required: true, message: t('pegaAuth.validation.confirmPasswordRequired') },
                  ({ getFieldValue }) => ({
                    validator(_, value) {
                      if (!value || getFieldValue('password') === value) {
                        return Promise.resolve();
                      }
                      return Promise.reject(new Error(t('pegaAuth.validation.passwordMismatch')));
                    },
                  }),
                ]}
              >
                <Input.Password autoComplete="new-password" />
              </Form.Item>
              <Form.Item>
                <Button type="primary" htmlType="submit" loading={loading} block>
                  {t('pegaAuth.actions.register')}
                </Button>
              </Form.Item>
            </Form>
          );

          const tabItems: TabsProps['items'] = [
            { key: TAB_LOGIN, label: t('pegaAuth.tabs.login'), children: loginTab },
            { key: TAB_REGISTER, label: t('pegaAuth.tabs.register'), children: registerTab },
          ];

          return (
            <Card title={t('llmSetup.cards.pegaAuth')} style={{ maxWidth: 500, margin: '0 auto' }}>
              <Paragraph>{t('llmSetup.descriptions.pegaAuth')}</Paragraph>
              {pegaLoggedIn ? (
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Alert
                    message={t('llmSetup.messages.pegaAlreadyLoggedIn')}
                    type="success"
                    showIcon
                  />
                  <Button
                    type="primary"
                    onClick={() => {
                      setCurrentStep(2);
                      void fetchModels();
                    }}
                    block
                  >
                    {t('common.next')}
                  </Button>
                </Space>
              ) : (
                <>
                  <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} />
                  <Button
                    type="link"
                    onClick={handlePegaSkip}
                    loading={loading}
                    style={{ marginTop: 8 }}
                  >
                    {t('llmSetup.actions.skipLogin')}
                  </Button>
                </>
              )}
              <Button
                style={{ marginTop: 16 }}
                onClick={() => setCurrentStep(0)}
              >
                {t('common.back')}
              </Button>
            </Card>
          );
        }

        return (
          <Card title={t('llmSetup.cards.configureProvider')} style={{ maxWidth: 600, margin: '0 auto' }}>
            <Form form={configForm} layout="vertical" onFinish={handleSaveConfig}>
              {providerNeedsEndpoint && (
                <Form.Item
                  name="endpoint"
                  label={t('llmSetup.form.endpointLabel')}
                  rules={[{ required: true, message: t('llmSetup.validation.endpointRequired') }]}
                >
                  <Input placeholder={t('llmSetup.placeholders.endpoint')} />
                </Form.Item>
              )}
              {providerNeedsApiKey && (
                <Form.Item
                  name="apiKey"
                  label={t('llmSetup.form.apiKeyLabel')}
                  rules={[{ required: true, message: t('llmSetup.validation.apiKeyRequired') }]}
                >
                  <Input.Password
                    placeholder={t('llmSetup.placeholders.apiKey')}
                    autoComplete="new-password"
                  />
                </Form.Item>
              )}
              {!providerNeedsEndpoint && !providerNeedsApiKey && (
                <Alert
                  message={t('llmSetup.messages.noConfigNeeded')}
                  type="info"
                  showIcon
                  style={{ marginBottom: 16 }}
                />
              )}
              <Space>
                <Button onClick={() => setCurrentStep(0)}>{t('common.back')}</Button>
                <Button type="primary" htmlType="submit" loading={loading}>
                  {t('common.next')}
                </Button>
              </Space>
            </Form>
          </Card>
        );

      case 2:
        return (
          <Card title={t('llmSetup.cards.selectModels')} style={{ maxWidth: 600, margin: '0 auto' }}>
            {modelsLoading ? (
              <div style={{ textAlign: 'center', padding: 40 }}>
                <Spin size="large" />
                <Paragraph style={{ marginTop: 16 }}>{t('llmSetup.messages.loadingModels')}</Paragraph>
              </div>
            ) : modelsError ? (
              <Space direction="vertical" style={{ width: '100%' }}>
                <Alert message={modelsError} type="error" showIcon />
                <Space>
                  <Button onClick={() => setCurrentStep(1)}>{t('common.back')}</Button>
                  <Button onClick={fetchModels}>{t('common.retry')}</Button>
                  <Button type="primary" onClick={handleSkipModels}>
                    {t('llmSetup.actions.skipModelSelection')}
                  </Button>
                </Space>
              </Space>
            ) : (
              <Form form={modelForm} layout="vertical" onFinish={handleSaveModels}>
                <Form.Item name="chatModel" label={t('llmSetup.form.chatModelLabel')}>
                  <Select
                    placeholder={t('llmSetup.placeholders.selectModel')}
                    options={
                      models?.chatModels.map((m) => ({ value: m.id, label: m.name || m.id })) || []
                    }
                    allowClear
                    showSearch
                    filterOption={(input, option) =>
                      (option?.label?.toString() || '').toLowerCase().includes(input.toLowerCase())
                    }
                  />
                </Form.Item>
                <Form.Item name="visionModel" label={t('llmSetup.form.visionModelLabel')}>
                  <Select
                    placeholder={t('llmSetup.placeholders.selectModel')}
                    options={
                      models?.visionModels.map((m) => ({ value: m.id, label: m.name || m.id })) || []
                    }
                    allowClear
                    showSearch
                    filterOption={(input, option) =>
                      (option?.label?.toString() || '').toLowerCase().includes(input.toLowerCase())
                    }
                  />
                </Form.Item>
                <Form.Item name="embedModel" label={t('llmSetup.form.embedModelLabel')}>
                  <Select
                    placeholder={t('llmSetup.placeholders.selectModel')}
                    options={
                      models?.embedModels.map((m) => ({ value: m.id, label: m.name || m.id })) || []
                    }
                    allowClear
                    showSearch
                    filterOption={(input, option) =>
                      (option?.label?.toString() || '').toLowerCase().includes(input.toLowerCase())
                    }
                  />
                </Form.Item>
                <Space>
                  <Button onClick={() => setCurrentStep(1)}>{t('common.back')}</Button>
                  <Button onClick={fetchModels}>{t('llmSetup.actions.refreshModels')}</Button>
                  <Button type="primary" htmlType="submit" loading={loading}>
                    {t('llmSetup.actions.completeSetup')}
                  </Button>
                </Space>
              </Form>
            )}
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

          <Title level={2} style={{ textAlign: 'center', marginBottom: 24 }}>
            {t('llmSetup.pageTitle')}
          </Title>

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

export default LLMSetup;
