import { Layout } from 'antd';
import { useNavigate } from 'react-router-dom';
import ProviderConfigForm, { type FieldDefinition } from '../../components/providers/ProviderConfigForm';

const { Content } = Layout;

const LLAMACPP_DEFAULTS = {
  llamacppTextModelPath: undefined,
  llamacppVisionModelPath: undefined,
  llamacppVisionDecoderPath: undefined,
  llamacppInstallDir: undefined,
  llamacppPort: 8080,
  llamacppHost: '127.0.0.1',
};

const LLAMACPP_FIELDS: FieldDefinition[] = [
  {
    name: 'llamacppTextModelPath',
    labelKey: 'providerConfig.llamacpp.fields.textModelPath.label',
    placeholderKey: 'providerConfig.llamacpp.fields.textModelPath.placeholder',
    extraKey: 'providerConfig.llamacpp.fields.textModelPath.extra',
  },
  {
    name: 'llamacppVisionModelPath',
    labelKey: 'providerConfig.llamacpp.fields.visionModelPath.label',
    placeholderKey: 'providerConfig.llamacpp.fields.visionModelPath.placeholder',
    extraKey: 'providerConfig.llamacpp.fields.visionModelPath.extra',
  },
  {
    name: 'llamacppVisionDecoderPath',
    labelKey: 'providerConfig.llamacpp.fields.visionDecoderPath.label',
    placeholderKey: 'providerConfig.llamacpp.fields.visionDecoderPath.placeholder',
    extraKey: 'providerConfig.llamacpp.fields.visionDecoderPath.extra',
  },
  {
    name: 'llamacppInstallDir',
    labelKey: 'providerConfig.llamacpp.fields.installDir.label',
    placeholderKey: 'providerConfig.llamacpp.fields.installDir.placeholder',
    extraKey: 'providerConfig.llamacpp.fields.installDir.extra',
  },
  {
    name: 'llamacppHost',
    labelKey: 'providerConfig.llamacpp.fields.host.label',
    placeholderKey: 'providerConfig.llamacpp.fields.host.placeholder',
  },
  {
    name: 'llamacppPort',
    labelKey: 'providerConfig.llamacpp.fields.port.label',
    placeholderKey: 'providerConfig.llamacpp.fields.port.placeholder',
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
