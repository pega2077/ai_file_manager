import { useState } from 'react'
import { Button, Layout, Typography, Space } from 'antd'
import { DesktopOutlined, FileTextOutlined } from '@ant-design/icons'
import reactLogo from './assets/react.svg'
import viteLogo from '/electron-vite.animate.svg'
import './App.css'

const { Header, Content, Footer } = Layout
const { Title, Text } = Typography

function App() {
  const [count, setCount] = useState(0)

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ display: 'flex', alignItems: 'center' }}>
        <Space>
          <DesktopOutlined style={{ color: 'white', fontSize: '24px' }} />
          <Title level={3} style={{ color: 'white', margin: 0 }}>
            AI File Manager
          </Title>
        </Space>
      </Header>

      <Content style={{ padding: '24px', background: '#fff' }}>
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <Space direction="vertical" size="large">
            <div>
              <a href="https://electron-vite.github.io" target="_blank">
                <img src={viteLogo} className="logo" alt="Vite logo" />
              </a>
              <a href="https://react.dev" target="_blank">
                <img src={reactLogo} className="logo react" alt="React logo" />
              </a>
            </div>

            <Title level={1}>Vite + React + Ant Design</Title>

            <div>
              <Button
                type="primary"
                size="large"
                icon={<FileTextOutlined />}
                onClick={() => setCount((count) => count + 1)}
              >
                Count is {count}
              </Button>
            </div>

            <Text type="secondary">
              Edit <code>src/App.tsx</code> and save to test HMR
            </Text>

            <Text>
              Ant Design components are now available in your Electron app!
            </Text>
          </Space>
        </div>
      </Content>

      <Footer style={{ textAlign: 'center' }}>
        AI File Manager ©2025 Created with Electron + React + Ant Design
      </Footer>
    </Layout>
  )
}

export default App
