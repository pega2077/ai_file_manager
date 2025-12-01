import { Layout } from 'antd';
import { useNavigate } from 'react-router-dom';
import ProviderConfigForm, { type FieldDefinition } from '../../components/providers/ProviderConfigForm';

const { Content } = Layout;

const OPENROUTER_DEFAULTS = {
  openrouterEndpoint: 'https://openrouter.ai/api/v1',
  openrouterModel: 'openai/gpt-oss-20b:free',
  openrouterEmbedModel: 'all-MiniLM-L6-v2',
  openrouterVisionModel: 'google/gemma-3-12b-it:free',
  openrouterApiKey: undefined,
};

const OPENROUTER_FIELDS: FieldDefinition[] = [
  {
    name: 'openrouterEndpoint',
    labelKey: 'providerConfig.openrouter.fields.endpoint.label',
    placeholderKey: 'providerConfig.openrouter.fields.endpoint.placeholder',
  },
  {
    name: 'openrouterApiKey',
    labelKey: 'providerConfig.openrouter.fields.apiKey.label',
    placeholderKey: 'providerConfig.openrouter.fields.apiKey.placeholder',
    inputType: 'password',
  },
  {
    name: 'openrouterModel',
    labelKey: 'providerConfig.openrouter.fields.model.label',
    placeholderKey: 'providerConfig.openrouter.fields.model.placeholder',
    inputType: 'select',
    modelType: 'chat',
    extraKey: 'providerConfig.openrouter.fields.model.extra',
  },
  {
    name: 'openrouterEmbedModel',
    labelKey: 'providerConfig.openrouter.fields.embedModel.label',
    placeholderKey: 'providerConfig.openrouter.fields.embedModel.placeholder',
    inputType: 'select',
    modelType: 'embed',
    extraKey: 'providerConfig.openrouter.fields.embedModel.extra',
  },
  {
    name: 'openrouterVisionModel',
    labelKey: 'providerConfig.openrouter.fields.visionModel.label',
    placeholderKey: 'providerConfig.openrouter.fields.visionModel.placeholder',
    inputType: 'select',
    modelType: 'vision',
    extraKey: 'providerConfig.openrouter.fields.visionModel.extra',
  },
];

const OpenRouterConfig = () => {
  const navigate = useNavigate();

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Content style={{ padding: '24px', background: '#fff' }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <ProviderConfigForm
            providerKey="openrouter"
            titleKey="providerConfig.openrouter.title"
            descriptionKey="providerConfig.openrouter.description"
            fields={OPENROUTER_FIELDS}
            defaults={OPENROUTER_DEFAULTS}
            backLabelKey="providerConfig.common.back"
            backHandler={() => navigate('/settings')}
          />
        </div>
      </Content>
    </Layout>
  );
};

export default OpenRouterConfig;
