import { Layout } from 'antd';
import { useNavigate } from 'react-router-dom';
import ProviderConfigForm, { type FieldDefinition } from '../../components/providers/ProviderConfigForm';

const { Content } = Layout;

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
        </div>
      </Content>
    </Layout>
  );
};

export default LlamaCppConfig;
