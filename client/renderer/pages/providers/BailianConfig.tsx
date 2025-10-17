import { Layout } from 'antd';
import { useNavigate } from 'react-router-dom';
import ProviderConfigForm, { type FieldDefinition } from '../../components/providers/ProviderConfigForm';

const { Content } = Layout;

const BAILIAN_DEFAULTS = {
  bailianEndpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  bailianModel: 'qwen-plus',
  bailianEmbedModel: 'text-embedding-v4',
  bailianVisionModel: 'qwen3-vl-plus',
  bailianApiKey: undefined,
};

const BAILIAN_FIELDS: FieldDefinition[] = [
  {
    name: 'bailianEndpoint',
    labelKey: 'providerConfig.bailian.fields.endpoint.label',
    placeholderKey: 'providerConfig.bailian.fields.endpoint.placeholder',
  },
  {
    name: 'bailianApiKey',
    labelKey: 'providerConfig.bailian.fields.apiKey.label',
    placeholderKey: 'providerConfig.bailian.fields.apiKey.placeholder',
    inputType: 'password',
  },
  {
    name: 'bailianModel',
    labelKey: 'providerConfig.bailian.fields.model.label',
    placeholderKey: 'providerConfig.bailian.fields.model.placeholder',
    extraKey: 'providerConfig.bailian.fields.model.extra',
  },
  {
    name: 'bailianEmbedModel',
    labelKey: 'providerConfig.bailian.fields.embedModel.label',
    placeholderKey: 'providerConfig.bailian.fields.embedModel.placeholder',
    extraKey: 'providerConfig.bailian.fields.embedModel.extra',
  },
  {
    name: 'bailianVisionModel',
    labelKey: 'providerConfig.bailian.fields.visionModel.label',
    placeholderKey: 'providerConfig.bailian.fields.visionModel.placeholder',
    extraKey: 'providerConfig.bailian.fields.visionModel.extra',
  },
];

const BailianConfig = () => {
  const navigate = useNavigate();

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Content style={{ padding: '24px', background: '#fff' }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <ProviderConfigForm
            providerKey="bailian"
            titleKey="providerConfig.bailian.title"
            descriptionKey="providerConfig.bailian.description"
            fields={BAILIAN_FIELDS}
            defaults={BAILIAN_DEFAULTS}
            backLabelKey="providerConfig.common.back"
            backHandler={() => navigate('/settings')}
          />
        </div>
      </Content>
    </Layout>
  );
};

export default BailianConfig;
