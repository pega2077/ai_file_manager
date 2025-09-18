
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

      if (window.electronStore) {
        try {
          const savedSettings = (await window.electronStore.get('settings')) as Partial<SettingsState> | undefined;
          const workDirectory = (await window.electronStore.get('workDirectory')) as string | undefined;

          if (savedSettings) {
            console.log('Loaded settings from store:', savedSettings);
            const normalizedLanguage = normalizeLocale(savedSettings.language ?? defaultLocale);
            nextState = {
              ...nextState,
              ...savedSettings,
              language: normalizedLanguage,
            };

            if (normalizedLanguage !== locale) {
              setLocale(normalizedLanguage);
            }
          }

          if (typeof workDirectory === 'string') {
            nextState.workDirectory = workDirectory;
          }
        } catch (error) {
          console.error('Failed to load settings:', error);
        }
      }

      if (window.electronAPI) {
        try {
          const url = await window.electronAPI.getApiBaseUrl();
          setApiBaseUrl(url);
        } catch (error) {
          console.error('Failed to load API base URL:', error);
        }
      }

      setSettings(nextState);
    };

    void loadSettings();
  }, [locale, setLocale]);

  useEffect(() => {
    setSettings((prev) => (prev.language === locale ? prev : { ...prev, language: locale }));
  }, [locale]);

  const handleSettingChange = <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => {
    setSettings((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const handleLocaleChange = async (value: SupportedLocale) => {
    console.log('Selected locale:', value);
    if (value !== locale) {
      // First update the language value in electron store
      const newSettings = { ...settings, language: value };
      if (window.electronStore) {
        try {
          await window.electronStore.set('settings', newSettings);
        } catch (error) {
          console.error('Failed to save language to store:', error);
        }
      }
      setLocale(value);
      setSettings(newSettings);
    }
  };

  const handleSaveSettings = async () => {
    try {
      if (window.electronStore) {
        await window.electronStore.set('settings', settings);
        message.success(t('settings.messages.saveSuccess'));
      }
    } catch (error) {
      message.error(t('settings.messages.saveError'));
      console.error(error);
    }
  };

  const handleSaveApiBaseUrl = async () => {
    try {
      if (window.electronAPI) {
        await window.electronAPI.setApiBaseUrl(apiBaseUrl);
        updateApiBaseUrl(apiBaseUrl);
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
            if (window.electronStore) {
              await window.electronStore.set('isInitialized', false);
              await window.electronStore.set('workDirectory', '');
            }
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
              <Text strong>{t('settings.labels.apiBaseUrl')}</Text>
              <Input
                value={apiBaseUrl}
                onChange={(event) => setApiBaseUrl(event.target.value)}
                placeholder={t('settings.placeholders.apiBaseUrl')}
                style={{ marginTop: 8, marginBottom: 8 }}
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

