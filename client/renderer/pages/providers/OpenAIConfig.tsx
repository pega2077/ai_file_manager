import { Layout } from 'antd';
import { useNavigate } from 'react-router-dom';
import ProviderConfigForm, { type FieldDefinition } from '../../components/providers/ProviderConfigForm';

const { Content } = Layout;

const OPENAI_DEFAULTS = {
  openaiEndpoint: 'https://api.openai.com/v1',
  openaiModel: 'gpt-4o-mini',
  openaiEmbedModel: 'text-embedding-3-large',
  openaiVisionModel: 'gpt-4o-mini',
  openaiApiKey: undefined,
};

const OPENAI_FIELDS: FieldDefinition[] = [
  {
    name: 'openaiEndpoint',
    labelKey: 'providerConfig.openai.fields.endpoint.label',
    placeholderKey: 'providerConfig.openai.fields.endpoint.placeholder',
  },
  {
    name: 'openaiApiKey',
    labelKey: 'providerConfig.openai.fields.apiKey.label',
    placeholderKey: 'providerConfig.openai.fields.apiKey.placeholder',
    inputType: 'password',
  },
  {
    name: 'openaiModel',
    labelKey: 'providerConfig.openai.fields.model.label',
    placeholderKey: 'providerConfig.openai.fields.model.placeholder',
    extraKey: 'providerConfig.openai.fields.model.extra',
  },
  {
    name: 'openaiEmbedModel',
    labelKey: 'providerConfig.openai.fields.embedModel.label',
    placeholderKey: 'providerConfig.openai.fields.embedModel.placeholder',
    extraKey: 'providerConfig.openai.fields.embedModel.extra',
  },
  {
    name: 'openaiVisionModel',
    labelKey: 'providerConfig.openai.fields.visionModel.label',
    placeholderKey: 'providerConfig.openai.fields.visionModel.placeholder',
    extraKey: 'providerConfig.openai.fields.visionModel.extra',
  },
];

const OpenAIConfig = () => {
  const navigate = useNavigate();

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Content style={{ padding: '24px', background: '#fff' }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <ProviderConfigForm
            providerKey="openai"
            titleKey="providerConfig.openai.title"
            descriptionKey="providerConfig.openai.description"
            fields={OPENAI_FIELDS}
            defaults={OPENAI_DEFAULTS}
            backLabelKey="providerConfig.common.back"
            backHandler={() => navigate('/settings')}
          />
        </div>
      </Content>
    </Layout>
  );
};

export default OpenAIConfig;
