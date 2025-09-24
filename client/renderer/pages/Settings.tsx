
import { Layout, Card, Typography, Switch, Input, Button, message, Modal, Select } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiService, updateApiBaseUrl } from '../services/api';
import { useTranslation } from '../shared/i18n/I18nProvider';
import { defaultLocale, normalizeLocale, type SupportedLocale } from '../shared/i18n';

const { Content } = Layout;
const { Title, Text } = Typography;
const { TextArea } = Input;

interface SettingsState {
  theme: 'light' | 'dark';
  language: SupportedLocale;
  autoSave: boolean;
  showHiddenFiles: boolean;
  enablePreview: boolean;
  autoSaveRAG: boolean;
  autoClassifyWithoutConfirmation: boolean;
  workDirectory: string;
  useLocalService: boolean;
}

const DEFAULT_SETTINGS: SettingsState = {
  theme: 'light',
  language: defaultLocale,
  autoSave: true,
  showHiddenFiles: false,
  enablePreview: true,
  autoSaveRAG: true,
  autoClassifyWithoutConfirmation: false,
  workDirectory: '',
  useLocalService: true,
};

const Settings = () => {
  const navigate = useNavigate();
  const { t, locale, setLocale, availableLocales, localeLabels } = useTranslation();
  const [settings, setSettings] = useState<SettingsState>(() => ({
    ...DEFAULT_SETTINGS,
    language: locale,
  }));
  const [apiBaseUrl, setApiBaseUrl] = useState('http://localhost:8000');

  const languageOptions = useMemo(
    () =>
      availableLocales.map((localeKey) => ({
        value: localeKey,
        label: localeLabels[localeKey],
      })),
    [availableLocales, localeLabels],
  );

  useEffect(() => {
    const loadSettings = async () => {
      let nextState: SettingsState = { ...DEFAULT_SETTINGS, language: locale };

      try {
  const appConfig = (await window.electronAPI.getAppConfig()) as import('../shared/types').AppConfig;
        if (appConfig) {
          const normalizedLanguage = normalizeLocale(appConfig.language ?? defaultLocale);
          nextState = {
            ...nextState,
            theme: appConfig.theme ?? DEFAULT_SETTINGS.theme,
            language: normalizedLanguage,
            autoSave: Boolean(appConfig.autoSave ?? DEFAULT_SETTINGS.autoSave),
            showHiddenFiles: Boolean(appConfig.showHiddenFiles ?? DEFAULT_SETTINGS.showHiddenFiles),
            enablePreview: Boolean(appConfig.enablePreview ?? DEFAULT_SETTINGS.enablePreview),
            autoSaveRAG: Boolean(appConfig.autoSaveRAG ?? DEFAULT_SETTINGS.autoSaveRAG),
            autoClassifyWithoutConfirmation: Boolean(appConfig.autoClassifyWithoutConfirmation ?? DEFAULT_SETTINGS.autoClassifyWithoutConfirmation),
            workDirectory: String(appConfig.workDirectory ?? DEFAULT_SETTINGS.workDirectory),
            useLocalService: Boolean(appConfig.useLocalService ?? DEFAULT_SETTINGS.useLocalService),
          };

          if (normalizedLanguage !== locale) {
            setLocale(normalizedLanguage);
          }
        }
      } catch (error) {
        console.error('Failed to load app config:', error);
      }

      try {
        const url = await window.electronAPI.getApiBaseUrl();
        setApiBaseUrl(url);
      } catch (error) {
        console.error('Failed to load API base URL:', error);
      }

      setSettings(nextState);
    };

    void loadSettings();
  }, [locale, setLocale]);

  useEffect(() => {
    setSettings((prev) => (prev.language === locale ? prev : { ...prev, language: locale }));
  }, [locale]);

  useEffect(() => {
    if (settings.useLocalService) {
      setApiBaseUrl('http://localhost:8000');
    }
  }, [settings.useLocalService]);

  const handleSettingChange = <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => {
    setSettings((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const handleLocaleChange = async (value: SupportedLocale) => {
    console.log('Selected locale:', value);
    if (value !== locale) {
      const newSettings = { ...settings, language: value };
      try {
        await window.electronAPI.updateAppConfig({ language: value });
      } catch (error) {
        console.error('Failed to save language:', error);
      }
      setLocale(value);
      setSettings(newSettings);
    }
  };

  const handleSaveSettings = async () => {
    try {
      await window.electronAPI.updateAppConfig({
        theme: settings.theme,
        language: settings.language,
        autoSave: settings.autoSave,
        showHiddenFiles: settings.showHiddenFiles,
        enablePreview: settings.enablePreview,
        autoSaveRAG: settings.autoSaveRAG,
        autoClassifyWithoutConfirmation: settings.autoClassifyWithoutConfirmation,
        useLocalService: settings.useLocalService,
      });
      message.success(t('settings.messages.saveSuccess'));
    } catch (error) {
      message.error(t('settings.messages.saveError'));
      console.error(error);
    }
  };

  const handleSaveApiBaseUrl = async () => {
    try {
      if (window.electronAPI) {
        const urlToSave = settings.useLocalService ? 'http://localhost:8000' : apiBaseUrl;
        await window.electronAPI.setApiBaseUrl(urlToSave);
        updateApiBaseUrl(urlToSave);
        message.success(t('settings.messages.apiSuccess'));
      }
    } catch (error) {
      message.error(t('settings.messages.apiError'));
      console.error(error);
    }
  };

  const handleResetSettings = () => {
    const nextState: SettingsState = {
      ...DEFAULT_SETTINGS,
      language: defaultLocale,
      workDirectory: settings.workDirectory,
    };
    setSettings(nextState);
    setLocale(defaultLocale);
    message.success(t('settings.messages.resetSuccess'));
  };

  const handleClearAllData = () => {
    Modal.confirm({
      title: t('settings.messages.clearConfirmTitle'),
      content: t('settings.messages.clearConfirmContent'),
      okText: t('settings.messages.clearConfirmOk'),
      cancelText: t('settings.messages.clearConfirmCancel'),
      okType: 'danger',
      onOk: async () => {
        try {
          const response = await apiService.clearAllData();
          if (response.success) {
            await window.electronAPI.updateAppConfig({ isInitialized: false, workDirectory: '' });
            setSettings((prev) => ({ ...prev, workDirectory: '' }));
            message.success(t('settings.messages.clearSuccess'));
          } else {
            message.error(
              t('settings.messages.clearError', {
                reason: response.message ?? t('settings.messages.unknownError'),
              }),
            );
          }
        } catch (error) {
          message.error(t('settings.messages.clearException'));
          console.error('Clear data error:', error);
        }
      },
    });
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Content style={{ padding: '24px', background: '#fff' }}>
        <div style={{ maxWidth: 800, margin: '0 auto' }}>
          <Title level={2}>{t('settings.pageTitle')}</Title>

          <Card title={t('settings.sections.general')} style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <Text strong>{t('settings.labels.theme')}</Text>
                <Switch
                  checkedChildren={t('settings.themeOptions.dark')}
                  unCheckedChildren={t('settings.themeOptions.light')}
                  checked={settings.theme === 'dark'}
                  onChange={(checked) => handleSettingChange('theme', checked ? 'dark' : 'light')}
                  style={{ marginLeft: 16 }}
                />
              </div>

              <div>
                <Text strong>{t('settings.labels.language')}</Text>
                <Select
                  style={{ marginLeft: 16, minWidth: 160 }}
                  value={settings.language}
                  options={languageOptions}
                  onChange={(value) => handleLocaleChange(value as SupportedLocale)}
                />
              </div>

              <div>
                <Text strong>{t('settings.labels.autoSave')}</Text>
                <Switch
                  checkedChildren={t('settings.common.enabled')}
                  unCheckedChildren={t('settings.common.disabled')}
                  checked={settings.autoSave}
                  onChange={(checked) => handleSettingChange('autoSave', checked)}
                  style={{ marginLeft: 16 }}
                />
              </div>

              <div>
                <Text strong>{t('settings.labels.showHiddenFiles')}</Text>
                <Switch
                  checkedChildren={t('settings.common.enabled')}
                  unCheckedChildren={t('settings.common.disabled')}
                  checked={settings.showHiddenFiles}
                  onChange={(checked) => handleSettingChange('showHiddenFiles', checked)}
                  style={{ marginLeft: 16 }}
                />
              </div>

              <div>
                <Text strong>{t('settings.labels.enablePreview')}</Text>
                <Switch
                  checkedChildren={t('settings.common.enabled')}
                  unCheckedChildren={t('settings.common.disabled')}
                  checked={settings.enablePreview}
                  onChange={(checked) => handleSettingChange('enablePreview', checked)}
                  style={{ marginLeft: 16 }}
                />
                <Text type="secondary" style={{ marginLeft: 8 }}>
                  {t('settings.descriptions.enablePreview')}
                </Text>
              </div>

              <div>
                <Text strong>{t('settings.labels.autoSaveRAG')}</Text>
                <Switch
                  checkedChildren={t('settings.common.enabled')}
                  unCheckedChildren={t('settings.common.disabled')}
                  checked={settings.autoSaveRAG}
                  onChange={(checked) => handleSettingChange('autoSaveRAG', checked)}
                  style={{ marginLeft: 16 }}
                />
                <Text type="secondary" style={{ marginLeft: 8 }}>
                  {t('settings.descriptions.autoSaveRAG')}
                </Text>
              </div>

              <div>
                <Text strong>{t('settings.labels.autoClassify')}</Text>
                <Switch
                  checkedChildren={t('settings.common.enabled')}
                  unCheckedChildren={t('settings.common.disabled')}
                  checked={settings.autoClassifyWithoutConfirmation}
                  onChange={(checked) => handleSettingChange('autoClassifyWithoutConfirmation', checked)}
                  style={{ marginLeft: 16 }}
                />
                <Text type="secondary" style={{ marginLeft: 8 }}>
                  {t('settings.descriptions.autoClassify')}
                </Text>
              </div>
            </div>
          </Card>

          <Card title={t('settings.sections.workDirectory')} style={{ marginBottom: 24 }}>
            <div>
              <Text strong>{t('settings.labels.workDirectory')}</Text>
              <TextArea value={settings.workDirectory} readOnly rows={2} style={{ marginTop: 8 }} />
              <Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
                {t('settings.descriptions.workDirectory')}
              </Text>
            </div>
          </Card>

          <Card title={t('settings.sections.api')}
                style={{ marginBottom: 24 }}>
            <div>
              <div style={{ marginBottom: 16 }}>
                <Text strong>{t('settings.labels.useLocalService')}</Text>
                <Switch
                  checkedChildren={t('settings.common.enabled')}
                  unCheckedChildren={t('settings.common.disabled')}
                  checked={settings.useLocalService}
                  onChange={(checked) => handleSettingChange('useLocalService', checked)}
                  style={{ marginLeft: 16 }}
                />
                <Text type="secondary" style={{ marginLeft: 8 }}>
                  {t('settings.descriptions.useLocalService')}
                </Text>
              </div>

              <Text strong>{t('settings.labels.apiBaseUrl')}</Text>
              <Input
                value={apiBaseUrl}
                onChange={(event) => setApiBaseUrl(event.target.value)}
                placeholder={t('settings.placeholders.apiBaseUrl')}
                style={{ marginTop: 8, marginBottom: 8 }}
                disabled={settings.useLocalService}
              />
              <Text type="secondary" style={{ display: 'block' }}>
                {t('settings.descriptions.apiBaseUrl')}
              </Text>
              <Button type="primary" onClick={handleSaveApiBaseUrl} style={{ marginTop: 8 }}>
                {t('settings.actions.saveApiBaseUrl')}
              </Button>
            </div>
          </Card>

          <Card title={t('settings.sections.actions')}>
            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
              <Button type="primary" onClick={handleSaveSettings}>
                {t('settings.actions.save')}
              </Button>
              <Button onClick={handleResetSettings}>{t('settings.actions.reset')}</Button>
              <Button danger onClick={handleClearAllData}>
                {t('settings.actions.clear')}
              </Button>
              <Button onClick={() => navigate('/files')}>
                {t('settings.actions.back')}
              </Button>
            </div>
          </Card>
        </div>
      </Content>
    </Layout>
  );
};

export default Settings;

