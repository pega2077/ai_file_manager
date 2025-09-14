import { Layout } from 'antd';

const { Content } = Layout;

const Setup = () => {
  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Content style={{ padding: '24px', background: '#fff' }}>
        {/* Blank interface for now */}
        Setup Content
      </Content>
    </Layout>
  );
};

export default Setup;