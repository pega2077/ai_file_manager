import { Layout } from 'antd';
import { useNavigate } from 'react-router-dom';
import ProviderConfigForm, { type FieldDefinition } from '../../components/providers/ProviderConfigForm';

const { Content } = Layout;

const OLLAMA_DEFAULTS = {
  ollamaEndpoint: 'http://127.0.0.1:11434',
  ollamaModel: 'qwen3:8b',
  ollamaEmbedModel: 'bge-m3',
  ollamaVisionModel: 'qwen2.5vl:7b',
  ollamaApiKey: undefined,
};

const OLLAMA_FIELDS: FieldDefinition[] = [
  {
    name: 'ollamaEndpoint',
    labelKey: 'providerConfig.ollama.fields.endpoint.label',
    placeholderKey: 'providerConfig.ollama.fields.endpoint.placeholder',
  },
  {
    name: 'ollamaModel',
    labelKey: 'providerConfig.ollama.fields.model.label',
    placeholderKey: 'providerConfig.ollama.fields.model.placeholder',
    extraKey: 'providerConfig.ollama.fields.model.extra',
  },
  {
    name: 'ollamaEmbedModel',
    labelKey: 'providerConfig.ollama.fields.embedModel.label',
    placeholderKey: 'providerConfig.ollama.fields.embedModel.placeholder',
    extraKey: 'providerConfig.ollama.fields.embedModel.extra',
  },
  {
    name: 'ollamaVisionModel',
    labelKey: 'providerConfig.ollama.fields.visionModel.label',
    placeholderKey: 'providerConfig.ollama.fields.visionModel.placeholder',
    extraKey: 'providerConfig.ollama.fields.visionModel.extra',
  },
  {
    name: 'ollamaApiKey',
    labelKey: 'providerConfig.ollama.fields.apiKey.label',
    placeholderKey: 'providerConfig.ollama.fields.apiKey.placeholder',
    inputType: 'password',
  },
];

const OllamaConfig = () => {
  const navigate = useNavigate();

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Content style={{ padding: '24px', background: '#fff' }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <ProviderConfigForm
            providerKey="ollama"
            titleKey="providerConfig.ollama.title"
            descriptionKey="providerConfig.ollama.description"
            fields={OLLAMA_FIELDS}
            defaults={OLLAMA_DEFAULTS}
            backLabelKey="providerConfig.common.back"
            backHandler={() => navigate('/settings')}
          />
        </div>
      </Content>
    </Layout>
  );
};

export default OllamaConfig;
