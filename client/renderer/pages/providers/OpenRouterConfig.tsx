import { Layout } from 'antd';
import { useNavigate } from 'react-router-dom';
import ProviderConfigForm, { type FieldDefinition } from '../../components/providers/ProviderConfigForm';

const { Content } = Layout;

const OPENROUTER_DEFAULTS = {
  openrouterEndpoint: 'https://openrouter.ai/api/v1',
  openrouterModel: 'openai/gpt-oss-20b:free',
  openrouterEmbedModel: 'all-MiniLM-L6-v2',
  openrouterEmbedEndpoint: 'https://embed.pegamob.com',
  openrouterVisionModel: 'google/gemma-3-12b-it:free',
  openrouterApiKey: undefined,
  openrouterEmbedKey: undefined,
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
    extraKey: 'providerConfig.openrouter.fields.model.extra',
  },
  {
    name: 'openrouterEmbedModel',
    labelKey: 'providerConfig.openrouter.fields.embedModel.label',
    placeholderKey: 'providerConfig.openrouter.fields.embedModel.placeholder',
    extraKey: 'providerConfig.openrouter.fields.embedModel.extra',
  },
  {
    name: 'openrouterEmbedEndpoint',
    labelKey: 'providerConfig.openrouter.fields.embedEndpoint.label',
    placeholderKey: 'providerConfig.openrouter.fields.embedEndpoint.placeholder',
    extraKey: 'providerConfig.openrouter.fields.embedEndpoint.extra',
  },
  {
    name: 'openrouterEmbedKey',
    labelKey: 'providerConfig.openrouter.fields.embedKey.label',
    placeholderKey: 'providerConfig.openrouter.fields.embedKey.placeholder',
    inputType: 'password',
  },
  {
    name: 'openrouterVisionModel',
    labelKey: 'providerConfig.openrouter.fields.visionModel.label',
    placeholderKey: 'providerConfig.openrouter.fields.visionModel.placeholder',
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
