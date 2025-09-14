import { Layout } from 'antd';

const { Content } = Layout;

const Home = () => {
  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Content style={{ padding: '24px', background: '#fff' }}>
        {/* Blank interface for now */}
        Home Content
      </Content>
    </Layout>
  );
};

export default Home;