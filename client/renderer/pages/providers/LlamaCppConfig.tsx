import { useState } from 'react';
import { Layout, Card, Form, Input, Button, Space, Typography, message, Divider } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '../../shared/i18n/I18nProvider';
import ProviderConfigForm, { type FieldDefinition } from '../../components/providers/ProviderConfigForm';

const { Content } = Layout;
const { Title, Text, Paragraph } = Typography;

const LLAMACPP_DEFAULTS = {
  modelsDirectory: undefined, // Will use default from provider
  chatModelPath: undefined,
  embedModelPath: undefined,
  visionModelPath: undefined,
  contextSize: 4096,
  gpuLayers: -1,
  threads: undefined,
};

const LLAMACPP_FIELDS: FieldDefinition[] = [
  {
    name: 'modelsDirectory',
    labelKey: 'providerConfig.llamacpp.fields.modelsDirectory.label',
    placeholderKey: 'providerConfig.llamacpp.fields.modelsDirectory.placeholder',
    extraKey: 'providerConfig.llamacpp.fields.modelsDirectory.extra',
  },
  {
    name: 'chatModelPath',
    labelKey: 'providerConfig.llamacpp.fields.chatModelPath.label',
    placeholderKey: 'providerConfig.llamacpp.fields.chatModelPath.placeholder',
    extraKey: 'providerConfig.llamacpp.fields.chatModelPath.extra',
  },
  {
    name: 'embedModelPath',
    labelKey: 'providerConfig.llamacpp.fields.embedModelPath.label',
    placeholderKey: 'providerConfig.llamacpp.fields.embedModelPath.placeholder',
    extraKey: 'providerConfig.llamacpp.fields.embedModelPath.extra',
  },
  {
    name: 'visionModelPath',
    labelKey: 'providerConfig.llamacpp.fields.visionModelPath.label',
    placeholderKey: 'providerConfig.llamacpp.fields.visionModelPath.placeholder',
    extraKey: 'providerConfig.llamacpp.fields.visionModelPath.extra',
  },
  {
    name: 'contextSize',
    labelKey: 'providerConfig.llamacpp.fields.contextSize.label',
    placeholderKey: 'providerConfig.llamacpp.fields.contextSize.placeholder',
    extraKey: 'providerConfig.llamacpp.fields.contextSize.extra',
    inputType: 'number',
  },
  {
    name: 'gpuLayers',
    labelKey: 'providerConfig.llamacpp.fields.gpuLayers.label',
    placeholderKey: 'providerConfig.llamacpp.fields.gpuLayers.placeholder',
    extraKey: 'providerConfig.llamacpp.fields.gpuLayers.extra',
    inputType: 'number',
  },
  {
    name: 'threads',
    labelKey: 'providerConfig.llamacpp.fields.threads.label',
    placeholderKey: 'providerConfig.llamacpp.fields.threads.placeholder',
    extraKey: 'providerConfig.llamacpp.fields.threads.extra',
    inputType: 'number',
  },
];

const LlamaCppConfig = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [downloading, setDownloading] = useState(false);
  const [downloadForm] = Form.useForm();

  const handleDownload = async (values: { modelUrl: string; fileName: string }) => {
    try {
      setDownloading(true);
      const ipcRenderer = (window as Window & typeof globalThis & { ipcRenderer?: any }).ipcRenderer;
      
      if (!ipcRenderer) {
        message.error(t('providerConfig.llamacpp.download.ipcError'));
        return;
      }

      const result = await ipcRenderer.invoke('llamacpp:downloadModel', {
        url: values.modelUrl,
        fileName: values.fileName,
      });

      if (result.success) {
        message.success(t('providerConfig.llamacpp.download.success'));
        downloadForm.resetFields();
      } else {
        message.error(result.error || t('providerConfig.llamacpp.download.error'));
      }
    } catch (error) {
      console.error('Download error:', error);
      message.error(t('providerConfig.llamacpp.download.error'));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Content style={{ padding: '24px', background: '#fff' }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <ProviderConfigForm
            providerKey="llamacpp"
            titleKey="providerConfig.llamacpp.title"
            descriptionKey="providerConfig.llamacpp.description"
            fields={LLAMACPP_FIELDS}
            defaults={LLAMACPP_DEFAULTS}
            backLabelKey="providerConfig.common.back"
            backHandler={() => navigate('/settings')}
          />
          
          <Divider />
          
          <Card 
            title={
              <Space>
                <DownloadOutlined />
                <span>{t('providerConfig.llamacpp.download.title')}</span>
              </Space>
            }
            style={{ marginTop: 24 }}
          >
            <Paragraph type="secondary">
              {t('providerConfig.llamacpp.download.description')}
            </Paragraph>
            
            <Form
              form={downloadForm}
              layout="vertical"
              onFinish={handleDownload}
            >
              <Form.Item
                name="modelUrl"
                label={t('providerConfig.llamacpp.download.urlLabel')}
                rules={[
                  { required: true, message: t('providerConfig.llamacpp.download.urlRequired') },
                  { type: 'url', message: t('providerConfig.llamacpp.download.urlInvalid') },
                ]}
              >
                <Input 
                  placeholder={t('providerConfig.llamacpp.download.urlPlaceholder')}
                  disabled={downloading}
                />
              </Form.Item>
              
              <Form.Item
                name="fileName"
                label={t('providerConfig.llamacpp.download.fileNameLabel')}
                rules={[
                  { required: true, message: t('providerConfig.llamacpp.download.fileNameRequired') },
                  { pattern: /\.gguf$/, message: t('providerConfig.llamacpp.download.fileNameInvalid') },
                ]}
              >
                <Input 
                  placeholder={t('providerConfig.llamacpp.download.fileNamePlaceholder')}
                  disabled={downloading}
                />
              </Form.Item>
              
              <Form.Item>
                <Button 
                  type="primary" 
                  htmlType="submit" 
                  icon={<DownloadOutlined />}
                  loading={downloading}
                >
                  {t('providerConfig.llamacpp.download.button')}
                </Button>
              </Form.Item>
            </Form>
            
            <Divider />
            
            <div>
              <Text strong>{t('providerConfig.llamacpp.download.examplesTitle')}</Text>
              <ul style={{ marginTop: 8 }}>
                <li>
                  <Text type="secondary">
                    https://huggingface.co/TheBloke/Llama-2-7B-Chat-GGUF/resolve/main/llama-2-7b-chat.Q4_K_M.gguf
                  </Text>
                </li>
                <li>
                  <Text type="secondary">
                    https://huggingface.co/nomic-ai/nomic-embed-text-v1.5-GGUF/resolve/main/nomic-embed-text-v1.5.Q4_K_M.gguf
                  </Text>
                </li>
              </ul>
            </div>
          </Card>
        </div>
      </Content>
    </Layout>
  );
};

export default LlamaCppConfig;
