import { useEffect, useMemo, useRef, useState } from 'react';
import { Card, Form, Input, Button, Space, Spin, Typography, message, Tag, Select } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, QuestionCircleOutlined, ApiOutlined } from '@ant-design/icons';
import type { FormInstance } from 'antd/es/form';
import { useTranslation } from '../../shared/i18n/I18nProvider';
import type { AppConfig } from '../../shared/types';

type ProviderKey = 'ollama' | 'openai' | 'openrouter' | 'bailian' | 'llamacpp';

type ProviderRecord = Record<string, string | number | undefined>;

type ProviderConfigResponse = NonNullable<AppConfig[ProviderKey]> | Record<string, unknown>;

export interface FieldDefinition {
  name: string;
  inputType?: 'text' | 'password' | 'number' | 'textarea' | 'select';
  modelType?: 'chat' | 'vision' | 'embed';
  labelKey: string;
  placeholderKey?: string;
  extraKey?: string;
}

interface ProviderConfigFormProps {
  providerKey: ProviderKey;
  titleKey: string;
  descriptionKey?: string;
  fields: FieldDefinition[];
  defaults: ProviderRecord;
  backLabelKey: string;
  backHandler: () => void;
}

type FormValues = Record<string, string>;

type HealthStatus = 'unknown' | 'healthy' | 'unhealthy' | 'checking';

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

const { Title, Paragraph, Text } = Typography;

const sanitizeEntries = (raw: FormValues, fields: FieldDefinition[]): ProviderRecord => {
  const result: ProviderRecord = {};
  fields.forEach((field) => {
    const value = raw[field.name];
    if (typeof value !== 'string') {
      result[field.name] = undefined;
      return;
    }
    const trimmed = value.trim();
    result[field.name] = trimmed.length > 0 ? trimmed : undefined;
  });
  return result;
};

const toDisplayValues = (record: ProviderRecord, fields: FieldDefinition[]): FormValues => {
  const result: FormValues = {};
  fields.forEach((field) => {
    const value = record[field.name];
    result[field.name] = typeof value === 'string' ? value : '';
  });
  return result;
};

const mergeProviderConfig = (
  current: ProviderConfigResponse,
  updates: ProviderRecord,
): ProviderRecord => {
  const merged: ProviderRecord = {};
  if (current && typeof current === 'object') {
    Object.entries(current).forEach(([key, value]) => {
      if (typeof value === 'string') {
        merged[key] = value;
      }
    });
  }
  Object.entries(updates).forEach(([key, value]) => {
    merged[key] = value;
  });
  return merged;
};

const ProviderConfigForm = ({
  providerKey,
  titleKey,
  descriptionKey,
  fields,
  defaults,
  backLabelKey,
  backHandler,
}: ProviderConfigFormProps) => {
  const { t } = useTranslation();
  const [form] = Form.useForm<FormValues>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [healthStatus, setHealthStatus] = useState<HealthStatus>('unknown');
  const [initialValues, setInitialValues] = useState<FormValues>({});
  const [models, setModels] = useState<ModelsResponse | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const providerSnapshotRef = useRef<ProviderConfigResponse>({});

  const defaultDisplayValues = useMemo(() => toDisplayValues(defaults, fields), [defaults, fields]);

  const loadConfig = async (formInstance: FormInstance<FormValues>) => {
    setLoading(true);
    try {
      const config = (await window.electronAPI.getAppConfig()) as AppConfig | undefined;
      const providerConfig = (config?.[providerKey] as ProviderConfigResponse) ?? {};
      providerSnapshotRef.current = providerConfig;

      const displayValues: FormValues = {};
      fields.forEach((field) => {
        const rawValue = providerConfig && typeof providerConfig === 'object' ? (providerConfig as Record<string, unknown>)[field.name] : undefined;
        displayValues[field.name] = typeof rawValue === 'string' ? rawValue : '';
      });

      setInitialValues(displayValues);
      formInstance.setFieldsValue(displayValues);
    } catch (error) {
      console.error(`Failed to load ${providerKey} config:`, error);
      message.error(t('providerConfig.common.loadError'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadConfig(form);
    handleCheckHealth();
    // Auto-fetch models if there are select fields
    if (fields.some(field => field.inputType === 'select')) {
      void handleFetchModels();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerKey]);

  const handleSubmit = async (values: FormValues) => {
    setSaving(true);
    try {
      const sanitized = sanitizeEntries(values, fields);
      const merged = mergeProviderConfig(providerSnapshotRef.current, sanitized);
      await window.electronAPI.updateAppConfig({ [providerKey]: merged });
      providerSnapshotRef.current = merged;
      const display = toDisplayValues(merged, fields);
      setInitialValues(display);
      form.setFieldsValue(display);
      message.success(t('providerConfig.common.saveSuccess'));
    } catch (error) {
      console.error(`Failed to update ${providerKey} config:`, error);
      message.error(t('providerConfig.common.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    form.setFieldsValue(initialValues);
  };

  const handleRestoreDefaults = () => {
    form.setFieldsValue(defaultDisplayValues);
    message.info(t('providerConfig.common.restoredDefaults'));
  };

  const handleCheckHealth = async () => {
    setHealthStatus('checking');
    try {
      const apiBaseUrl = await window.electronAPI.getApiBaseUrl();
      const response = await fetch(`${apiBaseUrl}/api/providers/health`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ provider: providerKey }),
      });

      const result = await response.json() as {
        success: boolean;
        data?: { healthy: boolean };
        error?: { message: string };
      };

      if (result.success && result.data) {
        const isHealthy = result.data.healthy;
        setHealthStatus(isHealthy ? 'healthy' : 'unhealthy');
        message[isHealthy ? 'success' : 'warning'](
          t(isHealthy ? 'providerConfig.common.healthCheckSuccess' : 'providerConfig.common.healthCheckFailed')
        );
      } else {
        setHealthStatus('unhealthy');
        message.error(result.error?.message || t('providerConfig.common.healthCheckError'));
      }
    } catch (error) {
      console.error('Health check failed:', error);
      setHealthStatus('unhealthy');
      message.error(t('providerConfig.common.healthCheckError'));
    }
  };

  const handleFetchModels = async () => {
    setModelsLoading(true);
    try {
      const apiBaseUrl = await window.electronAPI.getApiBaseUrl();
      const response = await fetch(`${apiBaseUrl}/api/providers/models`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ provider: providerKey }),
      });

      const result = await response.json() as {
        success: boolean;
        data?: ModelsResponse;
        error?: { message: string };
      };

      if (result.success && result.data) {
        setModels(result.data);
        message.success(t('providerConfig.common.modelsFetched'));
      } else {
        setModels(null);
        message.error(result.error?.message || t('providerConfig.common.modelsFetchError'));
      }
    } catch (error) {
      console.error('Models fetch failed:', error);
      setModels(null);
      message.error(t('providerConfig.common.modelsFetchError'));
    } finally {
      setModelsLoading(false);
    }
  };

  const renderHealthStatus = () => {
    if (healthStatus === 'checking') {
      return <Tag icon={<Spin size="small" />} color="processing">{t('providerConfig.common.checking')}</Tag>;
    }
    if (healthStatus === 'healthy') {
      return <Tag icon={<CheckCircleOutlined />} color="success">{t('providerConfig.common.statusHealthy')}</Tag>;
    }
    if (healthStatus === 'unhealthy') {
      return <Tag icon={<CloseCircleOutlined />} color="error">{t('providerConfig.common.statusUnhealthy')}</Tag>;
    }
    return <Tag icon={<QuestionCircleOutlined />} color="default">{t('providerConfig.common.statusUnknown')}</Tag>;
  };

  return (
    <Card>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <Space direction="horizontal" size="small">
          <Button type="link" onClick={backHandler} style={{ padding: 0 }}>
            {t(backLabelKey)}
          </Button>
        </Space>
        <div>
          <Space direction="horizontal" size="middle" align="center">
            <Title level={3} style={{ marginBottom: 0 }}>
              {t(titleKey)}
            </Title>
            {renderHealthStatus()}
          </Space>
          {descriptionKey ? (
            <Paragraph type="secondary" style={{ marginTop: 8 }}>
              {t(descriptionKey)}
            </Paragraph>
          ) : null}
        </div>
        <Spin spinning={loading || saving} tip={loading ? t('providerConfig.common.loading') : undefined}>
          <Form<FormValues> form={form} layout="vertical" onFinish={handleSubmit} disabled={loading || saving}>
            {fields.map((field) => {
              const placeholder = field.placeholderKey ? t(field.placeholderKey) : undefined;
              const allowClear = field.inputType !== 'password';
              const autoComplete = field.inputType === 'password' ? 'new-password' : 'off';

              let inputNode: React.ReactNode;

              if (field.inputType === 'select') {
                const modelOptions = useMemo(() => {
                  if (!models || !field.modelType) return [];
                  const modelList = models[field.modelType + 'Models' as keyof ModelsResponse] as ModelInfo[];
                  return modelList?.map(model => ({
                    value: model.id,
                    label: model.name || model.id,
                  })) || [];
                }, [models, field.modelType]);

                inputNode = (
                  <Select
                    placeholder={placeholder}
                    allowClear={allowClear}
                    loading={modelsLoading}
                    options={modelOptions}
                    showSearch
                    filterOption={(input, option) =>
                      (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                    }
                  />
                );
              } else {
                let InputComponent: typeof Input | typeof Input.TextArea | typeof Input.Password = Input;
                if (field.inputType === 'password') {
                  InputComponent = Input.Password;
                } else if (field.inputType === 'textarea') {
                  InputComponent = Input.TextArea;
                }

                inputNode = field.inputType === 'textarea' ? (
                  <InputComponent
                    placeholder={placeholder}
                    allowClear={allowClear}
                    autoSize={{ minRows: 2, maxRows: 6 }}
                  />
                ) : (
                  <InputComponent
                    type={field.inputType === 'number' ? 'number' : undefined}
                    placeholder={placeholder}
                    allowClear={allowClear}
                    autoComplete={autoComplete}
                  />
                );
              }

              return (
                <Form.Item
                  key={field.name}
                  name={field.name}
                  label={t(field.labelKey)}
                  extra={field.extraKey ? t(field.extraKey) : undefined}
                >
                  {inputNode}
                </Form.Item>
              );
            })}
            <Form.Item>
              <Space size="middle">
                <Button type="primary" htmlType="submit">
                  {t('providerConfig.common.save')}
                </Button>
                <Button onClick={handleReset}>
                  {t('providerConfig.common.reset')}
                </Button>
                <Button onClick={handleRestoreDefaults}>
                  {t('providerConfig.common.restoreDefaults')}
                </Button>
                <Button
                  icon={<ApiOutlined />}
                  onClick={handleCheckHealth}
                  loading={healthStatus === 'checking'}
                  disabled={loading || saving}
                >
                  {t('providerConfig.common.checkHealth')}
                </Button>
                {fields.some(field => field.inputType === 'select') && (
                  <Button
                    onClick={handleFetchModels}
                    loading={modelsLoading}
                    disabled={loading || saving}
                  >
                    {t('providerConfig.common.fetchModels')}
                  </Button>
                )}
              </Space>
            </Form.Item>
          </Form>
        </Spin>
        <Text type="secondary">{t('providerConfig.common.envHint')}</Text>
      </Space>
    </Card>
  );
};

export default ProviderConfigForm;
