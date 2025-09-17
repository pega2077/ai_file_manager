import { Layout, Menu } from 'antd';
import { FolderOutlined, SettingOutlined, SearchOutlined, FileTextOutlined, SwapOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';

const { Sider } = Layout;

interface SidebarProps {
  selectedMenu: string;
}

const Sidebar = ({ selectedMenu }: SidebarProps) => {
  const navigate = useNavigate();

  const handleMenuClick = ({ key }: { key: string }) => {
    switch (key) {
      case 'file-list':
        navigate('/files');
        break;
      case 'search':
        navigate('/search');
        break;
      case 'files':
        navigate('/home');
        break;
      case 'settings':
        navigate('/settings');
        break;
      case 'convert':
        navigate('/convert');
        break;
      default:
        break;
    }
  };

  const menuItems = [
    {
      key: 'file-list',
      icon: <FileTextOutlined />,
      label: '文件列表',
    },
    {
      key: 'search',
      icon: <SearchOutlined />,
      label: '搜索',
    },
    {
      key: 'files',
      icon: <FolderOutlined />,
      label: '文件管理',
    },
    {
      key: 'convert',
      icon: <SwapOutlined />,
      label: '文件转换',
    },
    {
      key: 'settings',
      icon: <SettingOutlined />,
      label: '设置',
    },
  ];

  return (
    <Sider width={200} style={{ background: '#fff' }}>
      <Menu
        mode="inline"
        selectedKeys={[selectedMenu]}
        style={{ height: '100%', borderRight: 0 }}
        items={menuItems}
        onClick={handleMenuClick}
      />
    </Sider>
  );
};

export default Sidebar;
