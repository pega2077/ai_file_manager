import { useState, useEffect } from 'react';
import { Layout, Card, Form, Input, Button, Space, Typography, message, Progress, Divider, Select } from 'antd';
import { DownloadOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '../../shared/i18n/I18nProvider';

const { Content } = Layout;
const { Title, Paragraph, Text } = Typography;
const { Option } = Select;

interface DownloadProgress {
  model: string;
  status: 'idle' | 'downloading' | 'completed' | 'error';
  progress: number;
  message?: string;
  error?: string;
}

const TRANSFORMERJS_DEFAULTS = {
  transformerjsChatModel: 'Xenova/LaMini-Flan-T5-783M',
  transformerjsEmbedModel: 'Xenova/all-MiniLM-L6-v2',
  transformerjsVisionModel: 'Xenova/vit-gpt2-image-captioning',
  transformerjsCacheDir: '',
  transformerjsQuantization: 'q8',
};

const TransformerjsConfig = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<Record<string, DownloadProgress>>({
    chat: { model: '', status: 'idle', progress: 0 },
    embed: { model: '', status: 'idle', progress: 0 },
    vision: { model: '', status: 'idle', progress: 0 },
  });

  const loadConfig = async () => {
    try {
      const config = await window.electronAPI.getAppConfig();
      const transformerjsConfig = config?.transformerjs || {};
      form.setFieldsValue({
        transformerjsChatModel: transformerjsConfig.transformerjsChatModel || TRANSFORMERJS_DEFAULTS.transformerjsChatModel,
        transformerjsEmbedModel: transformerjsConfig.transformerjsEmbedModel || TRANSFORMERJS_DEFAULTS.transformerjsEmbedModel,
        transformerjsVisionModel: transformerjsConfig.transformerjsVisionModel || TRANSFORMERJS_DEFAULTS.transformerjsVisionModel,
        transformerjsCacheDir: transformerjsConfig.transformerjsCacheDir || TRANSFORMERJS_DEFAULTS.transformerjsCacheDir,
        transformerjsQuantization: transformerjsConfig.transformerjsQuantization || TRANSFORMERJS_DEFAULTS.transformerjsQuantization,
      });
    } catch (error) {
      console.error('Failed to load config:', error);
      message.error(t('providerConfig.common.loadError'));
    }
  };

  useEffect(() => {
    void loadConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async () => {
    setLoading(true);
    try {
      const values = await form.validateFields();
      const config = {
        transformerjsChatModel: values.transformerjsChatModel?.trim() || undefined,
        transformerjsEmbedModel: values.transformerjsEmbedModel?.trim() || undefined,
        transformerjsVisionModel: values.transformerjsVisionModel?.trim() || undefined,
        transformerjsCacheDir: values.transformerjsCacheDir?.trim() || undefined,
        transformerjsQuantization: values.transformerjsQuantization || undefined,
      };
      await window.electronAPI.updateAppConfig({ transformerjs: config });
      message.success(t('providerConfig.common.saveSuccess'));
    } catch (error) {
      console.error('Failed to save config:', error);
      message.error(t('providerConfig.common.saveError'));
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadModel = async (modelType: 'chat' | 'embed' | 'vision') => {
    const values = form.getFieldsValue();
    let modelName = '';
    
    if (modelType === 'chat') {
      modelName = values.transformerjsChatModel || TRANSFORMERJS_DEFAULTS.transformerjsChatModel;
    } else if (modelType === 'embed') {
      modelName = values.transformerjsEmbedModel || TRANSFORMERJS_DEFAULTS.transformerjsEmbedModel;
    } else {
      modelName = values.transformerjsVisionModel || TRANSFORMERJS_DEFAULTS.transformerjsVisionModel;
    }

    setDownloadProgress(prev => ({
      ...prev,
      [modelType]: { model: modelName, status: 'downloading', progress: 0 },
    }));

    try {
      // Register progress listener
      const progressListener = (data: { modelType: string; progress: number; message?: string }) => {
        if (data.modelType === modelType) {
          setDownloadProgress(prev => ({
            ...prev,
            [modelType]: {
              ...prev[modelType],
              progress: data.progress,
              message: data.message,
            },
          }));
        }
      };

      const removeListener = window.electronAPI.onModelDownloadProgress?.(progressListener);

      // Start download
      await window.electronAPI.downloadTransformerjsModel?.({ modelType, modelName });

      setDownloadProgress(prev => ({
        ...prev,
        [modelType]: { ...prev[modelType], status: 'completed', progress: 100 },
      }));
      
      message.success(t('providerConfig.transformerjs.downloadSuccess', { model: modelName }));

      // Clean up listener
      if (removeListener) {
        removeListener();
      }
    } catch (error) {
      console.error('Failed to download model:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isNetworkError = errorMessage.toLowerCase().includes('network') || 
                            errorMessage.toLowerCase().includes('fetch') ||
                            errorMessage.toLowerCase().includes('connection') ||
                            errorMessage.toLowerCase().includes('timeout');
      
      setDownloadProgress(prev => ({
        ...prev,
        [modelType]: { 
          ...prev[modelType], 
          status: 'error', 
          progress: 0,
          error: isNetworkError ? t('providerConfig.transformerjs.networkError') : errorMessage,
        },
      }));
      
      if (isNetworkError) {
        message.error(t('providerConfig.transformerjs.networkError'));
      } else {
        message.error(t('providerConfig.transformerjs.downloadError', { model: modelName }));
      }
    }
  };

  const renderDownloadButton = (modelType: 'chat' | 'embed' | 'vision') => {
    const progress = downloadProgress[modelType];
    const isDownloading = progress.status === 'downloading';
    
    return (
      <Space direction="vertical" style={{ width: '100%' }}>
        <Button
          icon={<DownloadOutlined />}
          onClick={() => handleDownloadModel(modelType)}
          loading={isDownloading}
          disabled={isDownloading}
          block
        >
          {t('providerConfig.transformerjs.downloadModel')}
        </Button>
        {isDownloading && (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Progress percent={Math.round(progress.progress)} status="active" />
            {progress.message && <Text type="secondary" style={{ fontSize: '12px' }}>{progress.message}</Text>}
          </Space>
        )}
        {progress.status === 'completed' && (
          <Text type="success">{t('providerConfig.transformerjs.downloadComplete')}</Text>
        )}
        {progress.status === 'error' && progress.error && (
          <Text type="danger" style={{ fontSize: '12px' }}>{progress.error}</Text>
        )}
      </Space>
    );
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Content style={{ padding: '24px', background: '#fff' }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <Card>
            <Title level={3}>{t('providerConfig.transformerjs.title')}</Title>
            <Paragraph type="secondary">
              {t('providerConfig.transformerjs.description')}
            </Paragraph>

            <Form form={form} layout="vertical">
              <Form.Item
                label={t('providerConfig.transformerjs.fields.chatModel.label')}
                name="transformerjsChatModel"
                extra={t('providerConfig.transformerjs.fields.chatModel.extra')}
              >
                <Input placeholder={t('providerConfig.transformerjs.fields.chatModel.placeholder')} />
              </Form.Item>
              {renderDownloadButton('chat')}

              <Divider />

              <Form.Item
                label={t('providerConfig.transformerjs.fields.embedModel.label')}
                name="transformerjsEmbedModel"
                extra={t('providerConfig.transformerjs.fields.embedModel.extra')}
              >
                <Input placeholder={t('providerConfig.transformerjs.fields.embedModel.placeholder')} />
              </Form.Item>
              {renderDownloadButton('embed')}

              <Divider />

              <Form.Item
                label={t('providerConfig.transformerjs.fields.visionModel.label')}
                name="transformerjsVisionModel"
                extra={t('providerConfig.transformerjs.fields.visionModel.extra')}
              >
                <Input placeholder={t('providerConfig.transformerjs.fields.visionModel.placeholder')} />
              </Form.Item>
              {renderDownloadButton('vision')}

              <Divider />

              <Form.Item
                label={t('providerConfig.transformerjs.fields.cacheDir.label')}
                name="transformerjsCacheDir"
                extra={t('providerConfig.transformerjs.fields.cacheDir.extra')}
              >
                <Input placeholder={t('providerConfig.transformerjs.fields.cacheDir.placeholder')} />
              </Form.Item>

              <Divider />

              <Form.Item
                label={t('providerConfig.transformerjs.fields.quantization.label')}
                name="transformerjsQuantization"
                extra={t('providerConfig.transformerjs.fields.quantization.extra')}
              >
                <Select placeholder={t('providerConfig.transformerjs.fields.quantization.placeholder')}>
                  <Option value="fp32">{t('providerConfig.transformerjs.quantizationOptions.fp32')}</Option>
                  <Option value="fp16">{t('providerConfig.transformerjs.quantizationOptions.fp16')}</Option>
                  <Option value="q8">{t('providerConfig.transformerjs.quantizationOptions.q8')}</Option>
                  <Option value="q4">{t('providerConfig.transformerjs.quantizationOptions.q4')}</Option>
                </Select>
              </Form.Item>

              <Space style={{ marginTop: 24 }}>
                <Button type="primary" onClick={handleSave} loading={loading}>
                  {t('providerConfig.common.save')}
                </Button>
                <Button onClick={() => form.setFieldsValue(TRANSFORMERJS_DEFAULTS)}>
                  {t('providerConfig.common.restoreDefaults')}
                </Button>
                <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/settings')}>
                  {t('providerConfig.common.back')}
                </Button>
              </Space>
            </Form>
          </Card>
        </div>
      </Content>
    </Layout>
  );
};

export default TransformerjsConfig;
