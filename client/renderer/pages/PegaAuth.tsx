import { useEffect, useMemo, useState } from 'react';
import { Layout, Card, Tabs, Form, Input, Button, Typography, message } from 'antd';
import type { TabsProps } from 'antd';
import { useNavigate } from 'react-router-dom';
import { apiService } from '../services/api';
import { useTranslation } from '../shared/i18n/I18nProvider';
import type { AppConfig } from '../shared/types';

const { Content } = Layout;
const { Title, Paragraph, Text } = Typography;

const TAB_LOGIN = 'login';
const TAB_REGISTER = 'register';

interface LoginFormValues {
  identifier: string;
  password: string;
}

interface RegisterFormValues {
  email: string;
  phone: string;
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
      const response = await apiService.registerPegaAccount({
        email: values.email,
        phone: values.phone,
        password: values.password,
      });
      message.success(response.message || t('pegaAuth.messages.registerSuccess'));
      loginForm.setFieldsValue({ identifier: values.email, password: values.password });
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
      const loginResponse = await apiService.loginPegaAccount(values);
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
      const nextPegaConfig = {
        ...(currentConfig?.pega ?? {}),
        pegaApiKey: apiKey,
        pegaAuthToken: token,
      };
      await window.electronAPI.updateAppConfig({ llmProvider: 'pega', pega: nextPegaConfig });
      apiService.setProvider('pega');

      setStoredApiKey(apiKey);
      setStoredToken(token);
      message.success(apiKeyResponse.message || t('pegaAuth.messages.apiKeySuccess'));
    } catch (error) {
      console.error('Login failed:', error);
      message.error(t('pegaAuth.messages.loginFailed'));
    } finally {
      setLoginLoading(false);
    }
  };

  const registerTab = (
    <Form layout="vertical" form={registerForm} onFinish={handleRegister}>
      <Form.Item
        name="email"
        label={t('pegaAuth.form.email')}
        rules={[{ required: true, message: t('pegaAuth.validation.emailRequired') }, { type: 'email', message: t('pegaAuth.validation.emailFormat') }]}
      >
        <Input placeholder="user@example.com" autoComplete="email" allowClear />
      </Form.Item>
      <Form.Item
        name="phone"
        label={t('pegaAuth.form.phone')}
        rules={[{ required: true, message: t('pegaAuth.validation.phoneRequired') }]}
      >
        <Input placeholder="1234567890" autoComplete="tel" allowClear />
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
      <Form.Item
        name="identifier"
        label={t('pegaAuth.form.identifier')}
        rules={[{ required: true, message: t('pegaAuth.validation.identifierRequired') }]}
      >
        <Input placeholder="user@example.com" autoComplete="username" allowClear />
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
