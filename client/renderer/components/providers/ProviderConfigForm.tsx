import { useEffect, useMemo, useRef, useState } from 'react';
import { Card, Form, Input, Button, Space, Spin, Typography, message } from 'antd';
import type { FormInstance } from 'antd/es/form';
import { useTranslation } from '../../shared/i18n/I18nProvider';
import type { AppConfig } from '../../shared/types';

type ProviderKey = 'ollama' | 'openai' | 'openrouter' | 'bailian' | 'transformerjs';

type ProviderRecord = Record<string, string | undefined>;

type ProviderConfigResponse = NonNullable<AppConfig[ProviderKey]> | Record<string, unknown>;

export interface FieldDefinition {
  name: string;
  inputType?: 'text' | 'password';
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
  const [initialValues, setInitialValues] = useState<FormValues>({});
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

  return (
    <Card>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <Space direction="horizontal" size="small">
          <Button type="link" onClick={backHandler} style={{ padding: 0 }}>
            {t(backLabelKey)}
          </Button>
        </Space>
        <div>
          <Title level={3} style={{ marginBottom: 0 }}>
            {t(titleKey)}
          </Title>
          {descriptionKey ? (
            <Paragraph type="secondary" style={{ marginTop: 8 }}>
              {t(descriptionKey)}
            </Paragraph>
          ) : null}
        </div>
        <Spin spinning={loading || saving} tip={loading ? t('providerConfig.common.loading') : undefined}>
          <Form<FormValues> form={form} layout="vertical" onFinish={handleSubmit} disabled={loading || saving}>
            {fields.map((field) => {
              const InputComponent = field.inputType === 'password' ? Input.Password : Input;
              return (
                <Form.Item
                  key={field.name}
                  name={field.name}
                  label={t(field.labelKey)}
                  extra={field.extraKey ? t(field.extraKey) : undefined}
                >
                  <InputComponent
                    placeholder={field.placeholderKey ? t(field.placeholderKey) : undefined}
                    allowClear={field.inputType !== 'password'}
                    autoComplete={field.inputType === 'password' ? 'new-password' : 'off'}
                  />
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
