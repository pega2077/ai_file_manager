import { Layout } from 'antd';
import { useNavigate } from 'react-router-dom';
import ProviderConfigForm, { type FieldDefinition } from '../../components/providers/ProviderConfigForm';

const { Content } = Layout;

const TRANSFORMERJS_DEFAULTS = {
  transformerjsChatModel: 'Xenova/LaMini-Flan-T5-783M',
  transformerjsEmbedModel: 'Xenova/all-MiniLM-L6-v2',
  transformerjsVisionModel: 'Xenova/vit-gpt2-image-captioning',
  transformerjsCacheDir: undefined,
};

const TRANSFORMERJS_FIELDS: FieldDefinition[] = [
  {
    name: 'transformerjsChatModel',
    labelKey: 'providerConfig.transformerjs.fields.chatModel.label',
    placeholderKey: 'providerConfig.transformerjs.fields.chatModel.placeholder',
    extraKey: 'providerConfig.transformerjs.fields.chatModel.extra',
  },
  {
    name: 'transformerjsEmbedModel',
    labelKey: 'providerConfig.transformerjs.fields.embedModel.label',
    placeholderKey: 'providerConfig.transformerjs.fields.embedModel.placeholder',
    extraKey: 'providerConfig.transformerjs.fields.embedModel.extra',
  },
  {
    name: 'transformerjsVisionModel',
    labelKey: 'providerConfig.transformerjs.fields.visionModel.label',
    placeholderKey: 'providerConfig.transformerjs.fields.visionModel.placeholder',
    extraKey: 'providerConfig.transformerjs.fields.visionModel.extra',
  },
  {
    name: 'transformerjsCacheDir',
    labelKey: 'providerConfig.transformerjs.fields.cacheDir.label',
    placeholderKey: 'providerConfig.transformerjs.fields.cacheDir.placeholder',
    extraKey: 'providerConfig.transformerjs.fields.cacheDir.extra',
  },
];

const TransformerjsConfig = () => {
  const navigate = useNavigate();

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Content style={{ padding: '24px', background: '#fff' }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <ProviderConfigForm
            providerKey="transformerjs"
            titleKey="providerConfig.transformerjs.title"
            descriptionKey="providerConfig.transformerjs.description"
            fields={TRANSFORMERJS_FIELDS}
            defaults={TRANSFORMERJS_DEFAULTS}
            backLabelKey="providerConfig.common.back"
            backHandler={() => navigate('/settings')}
          />
        </div>
      </Content>
    </Layout>
  );
};

export default TransformerjsConfig;
