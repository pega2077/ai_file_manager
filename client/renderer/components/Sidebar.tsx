import { Layout, Menu } from 'antd';
import { FolderOutlined, SettingOutlined, SearchOutlined, FileTextOutlined, SwapOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '../shared/i18n/I18nProvider';

const { Sider } = Layout;

interface SidebarProps {
  selectedMenu: string;
}

const Sidebar = ({ selectedMenu }: SidebarProps) => {
  const navigate = useNavigate();
  const { t } = useTranslation();

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
      label: t('sidebar.fileList'),
    },
    {
      key: 'search',
      icon: <SearchOutlined />,
      label: t('sidebar.search'),
    },
    {
      key: 'files',
      icon: <FolderOutlined />,
      label: t('sidebar.fileManagement'),
    },
    {
      key: 'convert',
      icon: <SwapOutlined />,
      label: t('sidebar.fileConvert'),
    },
    {
      key: 'settings',
      icon: <SettingOutlined />,
      label: t('sidebar.settings'),
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
