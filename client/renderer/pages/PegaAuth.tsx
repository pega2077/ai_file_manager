import { useEffect, useMemo, useState } from 'react';
import { Layout, Card, Tabs, Form, Input, Button, Typography, message, Modal } from 'antd';
import type { TabsProps } from 'antd';
import { useNavigate } from 'react-router-dom';
import { apiService } from '../services/api';
import { useTranslation } from '../shared/i18n/I18nProvider';
import type { AppConfig } from '../shared/types';

const { Content } = Layout;
const { Title, Paragraph, Text } = Typography;

const TAB_LOGIN = 'login';
const TAB_REGISTER = 'register';

type IdentifierType = 'email' | 'phone';

interface IdentifierDetectionResult {
  type: IdentifierType;
  normalized: string;
  raw: string;
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

const maskValue = (value: string, fallback: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }
  if (trimmed.length <= 8) {
    return trimmed;
  }
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phoneCandidatePattern = /^[+]?\d{6,20}$/;
const phoneBasicPattern = /^[+]?\d+$/;

const detectIdentifier = (input: string): IdentifierDetectionResult | null => {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  const lowered = trimmed.toLowerCase();
  if (emailPattern.test(lowered)) {
    return {
      type: 'email',
      normalized: lowered,
      raw: trimmed,
    };
  }

  const sanitized = trimmed.replace(/[\s()-]/g, '');
  if (!phoneBasicPattern.test(sanitized)) {
    return null;
  }

  const digits = sanitized.startsWith('+') ? sanitized.slice(1) : sanitized;
  if (!/^[0-9]{6,20}$/.test(digits)) {
    return null;
  }

  const normalized = sanitized.startsWith('+') ? `+${digits}` : digits;
  if (phoneCandidatePattern.test(normalized)) {
    return {
      type: 'phone',
      normalized,
      raw: trimmed,
    };
  }

  return null;
};

const PegaAuth = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [loginForm] = Form.useForm<LoginFormValues>();
  const [registerForm] = Form.useForm<RegisterFormValues>();
  const [activeTab, setActiveTab] = useState<string>(TAB_LOGIN);
  const [loginLoading, setLoginLoading] = useState(false);
  const [registerLoading, setRegisterLoading] = useState(false);
  const [storedApiKey, setStoredApiKey] = useState('');
  const [storedToken, setStoredToken] = useState('');
  const [logoutLoading, setLogoutLoading] = useState(false);
  const [previousProvider, setPreviousProvider] = useState<AppConfig['llmProvider'] | undefined>(undefined);

  useEffect(() => {
    let mounted = true;
    const loadConfig = async () => {
      try {
        const cfg = (await window.electronAPI.getAppConfig()) as AppConfig | undefined;
        if (!mounted || !cfg) {
          return;
        }
        const savedApiKey = typeof cfg.pega?.pegaApiKey === 'string' ? cfg.pega?.pegaApiKey : '';
        const savedToken = typeof cfg.pega?.pegaAuthToken === 'string' ? cfg.pega?.pegaAuthToken : '';
        setStoredApiKey(savedApiKey ?? '');
        setStoredToken(savedToken ?? '');
        const fallbackProvider = ((cfg.llmProvider && cfg.llmProvider !== 'pega'
          ? cfg.llmProvider
          : cfg.pega?.pegaPreviousProvider) ?? 'ollama') as AppConfig['llmProvider'];
        setPreviousProvider(fallbackProvider);
      } catch (error) {
        console.error('Failed to load pega config:', error);
      }
    };
    void loadConfig();
    return () => {
      mounted = false;
    };
  }, []);

  const maskedApiKey = useMemo(
    () => maskValue(storedApiKey, t('pegaAuth.messages.noApiKey')),
    [storedApiKey, t],
  );

  const maskedToken = useMemo(
    () => maskValue(storedToken, t('pegaAuth.messages.noToken')),
    [storedToken, t],
  );

  const handleRegister = async (values: RegisterFormValues) => {
    setRegisterLoading(true);
    try {
      const detection = detectIdentifier(values.identifier);
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
      setRegisterLoading(false);
    }
  };

  const handleLogin = async (values: LoginFormValues) => {
    setLoginLoading(true);
    try {
      const detection = detectIdentifier(values.identifier);
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

      const currentConfig = (await window.electronAPI.getAppConfig()) as AppConfig | undefined;
      const previousProviderValue = ((currentConfig?.llmProvider && currentConfig.llmProvider !== 'pega'
        ? currentConfig.llmProvider
        : currentConfig?.pega?.pegaPreviousProvider) ?? 'ollama') as AppConfig['llmProvider'];
      const nextPegaConfig = {
        ...(currentConfig?.pega ?? {}),
        pegaApiKey: apiKey,
        pegaAuthToken: token,
        pegaPreviousProvider: previousProviderValue,
      };
      await window.electronAPI.updateAppConfig({ llmProvider: 'pega', pega: nextPegaConfig });
      apiService.setProvider('pega');

      setStoredApiKey(apiKey);
      setStoredToken(token);
      setPreviousProvider(previousProviderValue);
      message.success(apiKeyResponse.message || t('pegaAuth.messages.apiKeySuccess'));
      loginForm.resetFields();
    } catch (error) {
      console.error('Login failed:', error);
      message.error(t('pegaAuth.messages.loginFailed'));
    } finally {
      setLoginLoading(false);
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
          return detectIdentifier(value)
            ? Promise.resolve()
            : Promise.reject(new Error(t('pegaAuth.validation.identifierFormat')));
        },
      }),
    ],
    [t],
  );

  const registerTab = (
    <Form layout="vertical" form={registerForm} onFinish={handleRegister}>
      <Form.Item name="identifier" label={t('pegaAuth.form.identifier')} rules={identifierFormRules}>
        <Input placeholder={t('pegaAuth.placeholders.identifier')} autoComplete="username" allowClear />
      </Form.Item>
      <Form.Item
        name="password"
        label={t('pegaAuth.form.password')}
        rules={[{ required: true, message: t('pegaAuth.validation.passwordRequired') }, { min: 6, message: t('pegaAuth.validation.passwordLength') }]}
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
        <Button type="primary" htmlType="submit" loading={registerLoading} block>
          {t('pegaAuth.actions.register')}
        </Button>
      </Form.Item>
    </Form>
  );

  const loginTab = (
    <Form layout="vertical" form={loginForm} onFinish={handleLogin}>
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
        <Button type="primary" htmlType="submit" loading={loginLoading} block>
          {t('pegaAuth.actions.login')}
        </Button>
      </Form.Item>
    </Form>
  );

  const tabItems: TabsProps['items'] = [
    {
      key: TAB_LOGIN,
      label: t('pegaAuth.tabs.login'),
      children: loginTab,
    },
    {
      key: TAB_REGISTER,
      label: t('pegaAuth.tabs.register'),
      children: registerTab,
    },
  ];

  const canLogout = Boolean(storedApiKey.trim() || storedToken.trim());

  const performLogout = async () => {
    setLogoutLoading(true);
    try {
      const currentConfig = (await window.electronAPI.getAppConfig()) as AppConfig | undefined;
      const fallbackProvider = ((currentConfig?.pega?.pegaPreviousProvider && currentConfig.pega.pegaPreviousProvider !== 'pega'
        ? currentConfig.pega.pegaPreviousProvider
        : previousProvider && previousProvider !== 'pega'
          ? previousProvider
          : undefined) ?? 'ollama') as AppConfig['llmProvider'];
      const nextPegaConfig = {
        ...(currentConfig?.pega ?? {}),
        pegaApiKey: undefined,
        pegaAuthToken: undefined,
        pegaPreviousProvider: fallbackProvider,
      };
      const updates: Partial<AppConfig> = {
        pega: nextPegaConfig,
      };
      if (currentConfig?.llmProvider === 'pega') {
        updates.llmProvider = fallbackProvider;
      }
      await window.electronAPI.updateAppConfig(updates);
      if (updates.llmProvider) {
        apiService.setProvider(updates.llmProvider);
      } else {
        apiService.clearProviderCache();
      }
      setStoredApiKey('');
      setStoredToken('');
      setPreviousProvider(fallbackProvider);
      message.success(t('pegaAuth.messages.logoutSuccess'));
    } catch (error) {
      console.error('Logout failed:', error);
      message.error(t('pegaAuth.messages.logoutFailed'));
    } finally {
      setLogoutLoading(false);
    }
  };

  const confirmLogout = () => {
    if (!canLogout || logoutLoading) {
      return;
    }
    Modal.confirm({
      title: t('pegaAuth.messages.logoutConfirmTitle'),
      content: t('pegaAuth.messages.logoutConfirmMessage'),
      okText: t('common.confirm'),
      cancelText: t('common.cancel'),
      okType: 'danger',
      onOk: () => performLogout(),
    });
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Content style={{ padding: '24px', background: '#fff' }}>
        <div style={{ maxWidth: 520, margin: '0 auto' }}>
          <Button type="link" onClick={() => navigate('/settings')} style={{ padding: 0, marginBottom: 16 }}>
            {t('pegaAuth.actions.back')}
          </Button>
          <Card>
            <Title level={3}>{t('pegaAuth.pageTitle')}</Title>
            <Paragraph>{t('pegaAuth.description')}</Paragraph>

            <div style={{ marginBottom: 16 }}>
              <Text strong>{t('pegaAuth.status.activeProvider')}</Text>
              <Paragraph style={{ margin: '4px 0 12px' }}>{t('pegaAuth.status.notice')}</Paragraph>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div>
                  <Text type="secondary">{t('pegaAuth.status.apiKey')}</Text>
                  <div>
                    <Text code>{maskedApiKey}</Text>
                  </div>
                </div>
                <div>
                  <Text type="secondary">{t('pegaAuth.status.token')}</Text>
                  <div>
                    <Text code>{maskedToken}</Text>
                  </div>
                </div>
              </div>
              <Button
                danger
                block
                style={{ marginTop: 12 }}
                onClick={confirmLogout}
                disabled={!canLogout}
                loading={logoutLoading}
              >
                {t('pegaAuth.actions.logout')}
              </Button>
            </div>

            <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} />

            <Button style={{ marginTop: 24 }} block onClick={() => navigate('/settings')}>
              {t('pegaAuth.actions.backToSettings')}
            </Button>
          </Card>
        </div>
      </Content>
    </Layout>
  );
};

export default PegaAuth;
